#!/bin/bash
#
# Galley.app 背後的服務管理（D-046，P8-T006）：在背景跑發布台（npm run dev），不開終端機。
#
#   scripts/galley-service.sh start     沒在跑就在背景起服務，等前端與後端 /api/health 都通才回 started；
#                                       已經是這支腳本起的（例如 app 當掉後重開）就接手，等它好了回 adopted。
#                                       埠被別人占著（例如 start.command 開的）→ 不起、結束碼 3。
#   scripts/galley-service.sh stop      關掉這支腳本起的整棵程序樹（先 SIGTERM，等一下還在才 SIGKILL），
#                                       確認兩個埠都放掉。不是我們起的一律不碰，回 not-running。
#   scripts/galley-service.sh status    印 ours（我們起的在跑）／other（埠有人在用，但不是我們起的）／stopped
#   scripts/galley-service.sh logpath   印記錄檔位置
#
# 怎麼認「我們起的」：起服務時把 process group id 與 leader 的啟動時間寫進 <資料目錄>/galley-service.pid。
# 之後只有「那個 pid 還活著、還是 group leader、啟動時間一模一樣」才算數；pid 被別的程序重用時啟動時間對不上，
# 當成過期檔清掉、不送任何訊號。leader 已經不在、group 裡還有程序時，只認工作目錄是這個 repo 的。
#
# macOS 沒有 setsid 指令：用 bash 的 job control（set -m），背景工作會自成一個 process group。
#
# 記錄檔：<資料目錄>/logs/galley.log（每次起服務前把上一次的留成 galley.log.1，只留一份；權限 0600）。
# 只收服務自己的輸出。資料目錄的規則跟 src/config/paths.ts 的 resolveDataDir 相同。
#
# 給測試用的覆寫（平常不用設）：
#   GALLEY_SERVICE_CMD   要跑的指令（交給 bash -c，預設 exec npm run dev）
#   GALLEY_UI_PORT       前端埠（預設 5173）     GALLEY_API_PORT   後端埠（預設 3000）
#   GALLEY_WAIT_SECONDS  等服務起來的上限（預設 120）
#   GALLEY_STOP_TIMEOUT  SIGTERM 後等幾秒才 SIGKILL（預設 8）
#   GALLEY_LOGIN_SHELL_TIMEOUT  問登入 shell 要 PATH 最多等幾秒（預設 10）
#   GALLEY_SERVICE_DRY_KILL=1   不真的送訊號，只把要送的印到 stderr（測試不合法的 pid 檔時的保險）
#   GALLEY_DATA_DIR      資料目錄（同 paths.ts）

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
# Galley.app 的 do shell script 只有很陽春的 PATH；系統工具（ps、curl、lsof）一定要找得到。
export PATH="${PATH:+$PATH:}/usr/bin:/bin:/usr/sbin:/sbin"

UI_PORT="${GALLEY_UI_PORT:-5173}"
API_PORT="${GALLEY_API_PORT:-3000}"
SERVICE_CMD="${GALLEY_SERVICE_CMD:-exec npm run dev}"
WAIT_SECONDS="${GALLEY_WAIT_SECONDS:-120}"
STOP_TIMEOUT="${GALLEY_STOP_TIMEOUT:-8}"
LOGIN_SHELL_TIMEOUT="${GALLEY_LOGIN_SHELL_TIMEOUT:-10}"

die() {
  local code="$1"
  shift
  echo "$*" >&2
  exit "$code"
}

for value in "$UI_PORT" "$API_PORT" "$WAIT_SECONDS" "$STOP_TIMEOUT" "$LOGIN_SHELL_TIMEOUT"; do
  case "$value" in
    '' | *[!0-9]*) die 1 "galley-service：埠與秒數要是正整數（收到「${value}」）。" ;;
  esac
done

UI_URL="http://127.0.0.1:$UI_PORT/"
HEALTH_URL="http://127.0.0.1:$API_PORT/api/health"

# ---- 資料目錄（跟 src/config/paths.ts 的 resolveDataDir 一樣）----
resolve_data_dir() {
  local override="${GALLEY_DATA_DIR:-}"
  if [ -n "${override//[[:space:]]/}" ]; then
    case "$override" in
      /*) ;;
      *) die 1 "GALLEY_DATA_DIR 要是絕對路徑（例如 /Users/你/Galley），現在是「${override}」" ;;
    esac
    while [ "${#override}" -gt 1 ] && [ "${override%/}" != "$override" ]; do override="${override%/}"; done
    DATA_DIR="$override"
  elif [ -f "$REPO_DIR/.git" ]; then
    # git worktree 用自己的資料目錄，不碰全機那一個（P8-T003）
    DATA_DIR="$REPO_DIR/.galley-data"
  elif [ "$(uname -s)" = "Darwin" ]; then
    DATA_DIR="$HOME/Library/Application Support/Galley"
  elif [ -n "${XDG_DATA_HOME:-}" ] && [ "${XDG_DATA_HOME#/}" != "$XDG_DATA_HOME" ]; then
    DATA_DIR="$XDG_DATA_HOME/galley"
  else
    DATA_DIR="$HOME/.local/share/galley"
  fi
}
resolve_data_dir
LOG_DIR="$DATA_DIR/logs"
LOG_FILE="$LOG_DIR/galley.log"
PID_FILE="$DATA_DIR/galley-service.pid"

# ---- 程序資訊 ----
# ps 一律固定 C locale＋UTC：lstart 是照當下時區印的，起服務和關服務的時區不同（例如出國改了時區）
# 時間就對不上，會把自己的服務當成別人的。只設在 ps 這一個指令上，不 export 給服務。
trim() { printf '%s' "$1" | tr -s ' ' | sed 's/^ //; s/ $//'; }
proc_field() { LC_ALL=C TZ=UTC0 ps -o "$1=" -p "$2" 2>/dev/null; }
proc_lstart() { trim "$(proc_field lstart "$1")"; }
proc_exists() { [ -n "$(proc_field pid "$1")" ]; }
# 活著（存在而且不是殭屍）
proc_live() {
  local stat
  stat="$(trim "$(proc_field stat "$1")")"
  [ -n "$stat" ] && [ "${stat#Z}" = "$stat" ]
}
proc_cwd() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; }
# group 裡還活著的程序
group_members() { LC_ALL=C TZ=UTC0 ps -A -o pid=,pgid=,stat= | awk -v pg="$1" '$2 == pg && $3 !~ /^Z/ { print $1 }'; }
# 從 roots（以空白分隔的 pid）往下找所有子孫（含 roots 自己），不管它們在哪個 group
descendants() {
  LC_ALL=C TZ=UTC0 ps -A -o pid=,ppid=,stat= | awk -v roots="$1" '
    BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) mark[r[i]] = 1 }
    $3 !~ /^Z/ { pid[NR] = $1; ppid[NR] = $2; total = NR }
    END {
      changed = 1
      while (changed) {
        changed = 0
        for (i = 1; i <= total; i++) if ((i in pid) && !(pid[i] in mark) && (ppid[i] in mark)) { mark[pid[i]] = 1; changed = 1 }
      }
      for (p in mark) print p
    }'
}

# 唯一送訊號的地方。target 是 pid 或 -pgid。不管呼叫端檢查過什麼，這裡自己再擋一次：
# ≤ 1（kill -- -1 會打到使用者所有程序）、不是數字、自己、自己所在的 group，一律不送。
MY_PGID="$(trim "$(proc_field pgid $$)")"
safe_kill() {
  local sig="$1" target="$2" n
  n="${target#-}"
  case "$n" in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  [ "$n" -gt 1 ] || return 1
  [ "$n" != "$$" ] || return 1
  [ "$n" != "$MY_PGID" ] || return 1
  if [ -n "${GALLEY_SERVICE_DRY_KILL:-}" ]; then
    echo "dry-kill $sig $target" >&2
    return 0
  fi
  kill -s "$sig" -- "$target" 2>/dev/null
}

# ---- pid 檔 ----
PF_PGID=""
PF_LSTART=""
PF_REPO=""
read_pid_file() {
  PF_PGID=""
  PF_LSTART=""
  PF_REPO=""
  [ -f "$PID_FILE" ] || return 1
  PF_PGID="$(sed -n 's/^pgid=//p' "$PID_FILE" | head -1)"
  PF_LSTART="$(trim "$(sed -n 's/^lstart=//p' "$PID_FILE" | head -1)")"
  PF_REPO="$(sed -n 's/^repo=//p' "$PID_FILE" | head -1)"
  case "$PF_PGID" in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  # 0、1（launchd）、自己所在的 group 一律不算
  [ "$PF_PGID" -gt 1 ] || return 1
  [ "$PF_PGID" != "$$" ] || return 1
  [ "$PF_PGID" != "$MY_PGID" ] || return 1
  [ -n "$PF_LSTART" ] || return 1
  return 0
}

# 判斷 pid 檔指的是不是我們起的服務。結果放 OWNED：
#   leader   leader 還活著、是 group leader、啟動時間一樣 → 整個 group 都是我們的
#   orphans  leader 不在了，group 裡還有工作目錄是這個 repo 的程序（ORPHANS 列出）
#   ""       不是（沒有 pid 檔、內容不合法、pid 被重用、都死了）
OWNED=""
ORPHANS=""
classify() {
  OWNED=""
  ORPHANS=""
  read_pid_file || return 0
  if proc_live "$PF_PGID"; then
    if [ "$(trim "$(proc_field pgid "$PF_PGID")")" = "$PF_PGID" ] && [ "$(proc_lstart "$PF_PGID")" = "$PF_LSTART" ]; then
      OWNED="leader"
    fi
    # 活著但對不上：pid 被別的程序重用了，不是我們的
    return 0
  fi
  # leader 不在（或只剩殭屍）：group 還有成員時，只認工作目錄是起服務時那個 repo 的
  [ -n "$PF_REPO" ] || return 0
  local pid
  for pid in $(group_members "$PF_PGID"); do
    [ "$(proc_cwd "$pid")" = "$PF_REPO" ] && ORPHANS="$ORPHANS $pid"
  done
  [ -n "$ORPHANS" ] && OWNED="orphans"
  return 0
}

# ---- 停止 ----
SNAPSHOT=""  # 每行「pid|啟動時間」：送訊號前再確認一次啟動時間，不打到被重用的 pid
snapshot_add() {
  local pid lstart
  for pid in $1; do
    case "$SNAPSHOT" in *"<$pid|"*) continue ;; esac
    lstart="$(proc_lstart "$pid")"
    [ -n "$lstart" ] && SNAPSHOT="$SNAPSHOT<$pid|$lstart>"
  done
}
snapshot_refresh() {
  if [ "$OWNED" = "leader" ]; then
    snapshot_add "$(descendants "$(group_members "$PF_PGID" | tr '\n' ' ')")"
  else
    snapshot_add "$(descendants "$ORPHANS")"
  fi
}
# 還活著、而且還是當初那個程序的快照 pid
snapshot_live() {
  local entry pid lstart rest="$SNAPSHOT"
  while [ -n "$rest" ]; do
    entry="${rest#<}"
    entry="${entry%%>*}"
    rest="${rest#*>}"
    pid="${entry%%|*}"
    lstart="${entry#*|}"
    proc_live "$pid" && [ "$(proc_lstart "$pid")" = "$lstart" ] && echo "$pid"
  done
}
send_signal() {
  local sig="$1" pid
  if [ "$OWNED" = "leader" ]; then
    safe_kill "$sig" "-$PF_PGID"
  fi
  for pid in $(snapshot_live); do
    safe_kill "$sig" "$pid"
  done
}
anything_left() {
  [ -n "$(snapshot_live)" ] && return 0
  [ "$OWNED" = "leader" ] && [ -n "$(group_members "$PF_PGID")" ] && return 0
  return 1
}
# 等到 anything_left 為假，最多 $1 秒
wait_gone() {
  local deadline=$((SECONDS + $1))
  while anything_left; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.2
    [ "$OWNED" = "leader" ] && snapshot_refresh
  done
  return 0
}
port_open() {
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/" >/dev/null 2>&1
  [ "$?" -ne 7 ] # 7＝連不上
}
# 停掉 classify 認定的服務。回傳 0＝程序都死了。
stop_owned() {
  SNAPSHOT=""
  snapshot_refresh
  send_signal TERM
  if ! wait_gone "$STOP_TIMEOUT"; then
    snapshot_refresh
    send_signal KILL
    wait_gone 3 || return 1
  fi
  rm -f "$PID_FILE"
  return 0
}
wait_ports_free() {
  local deadline=$((SECONDS + 5))
  while port_open "$UI_PORT" || port_open "$API_PORT"; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.2
  done
  return 0
}

cmd_stop() {
  classify
  if [ -z "$OWNED" ]; then
    rm -f "$PID_FILE"
    echo "not-running"
    return 0
  fi
  stop_owned || die 1 "發布台的服務有程序關不掉（process group ${PF_PGID}），請用「活動監視器」結束它們。記錄檔：$LOG_FILE"
  wait_ports_free || die 4 "Galley 起的服務已經關了，但埠 $UI_PORT 或 $API_PORT 還被別的程式占著。"
  echo "stopped"
}

cmd_status() {
  classify
  if [ -n "$OWNED" ]; then
    echo "ours"
    return 0
  fi
  rm -f "$PID_FILE"
  if port_open "$UI_PORT" || port_open "$API_PORT"; then echo "other"; else echo "stopped"; fi
}

# ---- 啟動 ----
have() { command -v "$1" >/dev/null 2>&1; }
# 在背景跑登入 shell、輸出寫暫存檔，最多等 LOGIN_SHELL_TIMEOUT 秒。
# 不用 $(...) 直接接：.zprofile 若在背景留了程序（例如 something &），管線要等所有寫端都關掉才結束，會卡住。
# 卡住（例如 .zprofile 在等輸入）就把它那一組收掉（set -m 讓它自成一組，不會打到別人）；正常結束的不動它留下的背景程序。
login_shell_path() {
  local tmp shell_pid deadline
  tmp="$(mktemp "${TMPDIR:-/tmp}/galley-login-path.XXXXXX")" || return 0
  set -m
  "$1" -l -c 'printf "\n__GALLEY_PATH__=%s\n" "$PATH"' </dev/null >"$tmp" 2>/dev/null &
  shell_pid=$!
  set +m
  deadline=$((SECONDS + LOGIN_SHELL_TIMEOUT + 1)) # SECONDS 是整數秒，+1 才保證至少等滿
  while kill -0 "$shell_pid" 2>/dev/null && ! grep -q '^__GALLEY_PATH__=' "$tmp"; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      safe_kill KILL "-$shell_pid"
      break
    fi
    sleep 0.1
  done
  sed -n 's/^__GALLEY_PATH__=//p' "$tmp" | tail -1
  rm -f "$tmp"
}
# 從使用者的登入 shell 拿 PATH（node 多半在 /opt/homebrew/bin，do shell script 的 PATH 沒有）。
ensure_node() {
  have node && have npm && return 0
  local login_shell="${SHELL:-}" login_path
  if [ -z "$login_shell" ] || [ ! -x "$login_shell" ]; then
    login_shell="$(dscl . -read "/Users/$(id -un)" UserShell 2>/dev/null | awk '{ print $2 }')"
  fi
  [ -n "$login_shell" ] && [ -x "$login_shell" ] || login_shell="/bin/zsh"
  login_path="$(login_shell_path "$login_shell")"
  [ -n "$login_path" ] && export PATH="$login_path:/usr/bin:/bin:/usr/sbin:/sbin"
  have node && have npm && return 0
  die 1 "找不到 node／npm（問過登入 shell $login_shell 的 PATH）。請確認在終端機裡打 node -v、npm -v 有反應。"
}

prepare_log() {
  if [ ! -d "$DATA_DIR" ]; then
    (umask 077 && mkdir -p "$DATA_DIR") || die 1 "建立資料目錄 $DATA_DIR 失敗。"
    chmod 700 "$DATA_DIR"
  fi
  (umask 077 && mkdir -p "$LOG_DIR") || die 1 "建立記錄檔資料夾 $LOG_DIR 失敗。"
  chmod 700 "$LOG_DIR"
  if [ -f "$LOG_FILE" ]; then mv -f "$LOG_FILE" "$LOG_FILE.1"; fi
  (umask 077 && : >"$LOG_FILE") || die 1 "建立記錄檔 $LOG_FILE 失敗。"
  chmod 600 "$LOG_FILE"
  if [ -f "$LOG_FILE.1" ]; then chmod 600 "$LOG_FILE.1"; fi
}

write_pid_file() {
  local tmp="$PID_FILE.tmp.$$"
  (umask 077 && printf 'pgid=%s\nlstart=%s\nrepo=%s\n' "$1" "$2" "$REPO_DIR" >"$tmp") &&
    chmod 600 "$tmp" && mv -f "$tmp" "$PID_FILE"
}

# 等前端有回應、後端 /api/health 回 2xx（跟 start.command 一樣的等法）。0＝好了、1＝逾時、2＝服務不在了。
wait_ready() {
  local deadline=$((SECONDS + WAIT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -s -o /dev/null --max-time 2 "$UI_URL" && curl -sf -o /dev/null --max-time 10 "$HEALTH_URL"; then
      return 0
    fi
    classify
    [ -n "$OWNED" ] || return 2
    sleep 0.5
  done
  return 1
}

# 等不到：把服務關掉（不留孤兒），說明原因與記錄檔位置
give_up() {
  local why="$1"
  classify
  [ -n "$OWNED" ] && stop_owned
  rm -f "$PID_FILE"
  die 2 "$why
記錄檔：$LOG_FILE"
}

cmd_start() {
  local adopted="" result
  classify
  if [ -n "$OWNED" ]; then
    adopted=1
  else
    rm -f "$PID_FILE"
    if port_open "$UI_PORT" || port_open "$API_PORT"; then
      die 3 "埠 $UI_PORT 或 $API_PORT 已經有程式在用（可能是 start.command 開的發布台），Galley 不另外起、也不接手它。"
    fi
    ensure_node
    prepare_log
    cd "$REPO_DIR" || die 1 "進不去程式資料夾 ${REPO_DIR}。"
    echo "=== Galley 在背景啟動發布台：$(date '+%Y-%m-%d %H:%M:%S') ===" >>"$LOG_FILE"
    # set -m：背景工作自成一個 process group（pgid＝它的 pid），stop 時整組送訊號。
    # stdin／stdout／stderr 全部接走，do shell script 才不會一直等它結束。
    set -m
    /bin/bash -c "$SERVICE_CMD" </dev/null >>"$LOG_FILE" 2>&1 &
    local pg=$!
    set +m
    write_pid_file "$pg" "$(proc_lstart "$pg")" || {
      safe_kill TERM "-$pg"
      die 1 "寫不進 ${PID_FILE}，已經把剛起的服務關掉。"
    }
  fi
  wait_ready
  result=$?
  case "$result" in
    0) if [ -n "$adopted" ]; then echo "adopted"; else echo "started"; fi ;;
    2) give_up "發布台的服務提早結束了，沒有起來。" ;;
    *) give_up "等了 ${WAIT_SECONDS} 秒發布台還沒起來，已經把它關掉。" ;;
  esac
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  logpath) echo "$LOG_FILE" ;;
  *) die 64 "用法：galley-service.sh start|stop|status|logpath" ;;
esac
