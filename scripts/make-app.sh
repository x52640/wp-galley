#!/bin/bash
#
# 產生 Galley.app：放在 Dock 上、點一下就能開發布台的小 app（D-044，P8-T005）。
#
#   scripts/make-app.sh              產生到 ~/Applications/Galley.app
#   scripts/make-app.sh <資料夾>      產生到 <資料夾>/Galley.app
#   scripts/make-app.sh --print-script   只印出 app 裡的 AppleScript（測試用），不產生 app
#
# app 點下去：
#   - 發布台已經在跑（5173 或 3000 有回應）→ 只開瀏覽器到 http://127.0.0.1:5173
#   - 沒在跑 → 用 open 打開這個 repo 的 scripts/start.command（跟雙擊一樣，開一個終端機視窗，
#     那個視窗就是服務本體），並在暫存目錄寫 galley-launch.stamp
#   - 沒在跑但 20 秒內才開過 start.command（還在起來）→ 只跳通知，不再開第二個
#
# repo 的絕對路徑在產生 app 時寫死進去。repo 搬家或改名之後，重跑一次這個腳本即可。
# 只用 macOS 內建工具（osacompile、sips、iconutil、PlistBuddy、codesign），不下載任何東西。
# 圖示來源是 scripts/app/icon.png（1024×1024），想換圖示就蓋掉它再重跑。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
START_COMMAND="$REPO_DIR/scripts/start.command"
ICON_PNG="$SCRIPT_DIR/app/icon.png"
APP_NAME="Galley"

fail() {
  echo "make-app：$*" >&2
  exit 1
}

# AppleScript 字串常值的跳脫：反斜線與雙引號前面各加一個反斜線。
applescript_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

# 換行放進 AppleScript 字串常值很難保證正確，路徑裡有換行就直接拒絕。
case "$REPO_DIR" in
  *$'\n'* | *$'\r'*) fail "repo 路徑裡有換行字元，無法產生 app：$REPO_DIR" ;;
esac

print_script() {
  cat <<APPLESCRIPT
-- Galley.app：由 scripts/make-app.sh 產生，不要手改；repo 搬家請重跑該腳本。
-- 不用 property：applet 執行後會把 property 寫回腳本檔，弄壞簽章。

on run
	set repoPath to $(applescript_string "$REPO_DIR")
	set uiURL to "http://127.0.0.1:5173"
	set healthURL to "http://127.0.0.1:3000/api/health"
	if serviceIsUp(uiURL, healthURL) then
		open location uiURL
		return
	end if
	set startCommand to repoPath & "/scripts/start.command"
	try
		do shell script "test -x " & quoted form of startCommand
	on error
		display dialog "找不到啟動腳本：" & return & startCommand & return & return & "repo 搬家或改名了嗎？請在新位置重跑 scripts/make-app.sh。" buttons {"好"} default button 1 with title "Galley" with icon caution
		return
	end try
	-- 剛點過、服務還在起來（埠還沒開）時再點一次：不要再開第二個 start.command（會撞埠），提示稍候就好。
	set stampPath to (POSIX path of (path to temporary items)) & "galley-launch.stamp"
	if launchedRecently(stampPath, 20) then
		display notification "發布台正在啟動，好了會自動打開瀏覽器。" with title "Galley"
		return
	end if
	do shell script "date +%s > " & quoted form of stampPath
	-- 跟在 Finder 雙擊一樣：開終端機視窗跑服務，start.command 會等前後端都起來再開瀏覽器。
	do shell script "open " & quoted form of startCommand
end run

-- 前端或後端任何一個有回應就當成已經在跑（可能還在啟動中），只開瀏覽器，
-- 不再開第二個 start.command（埠被占住只會在新視窗報錯）。
-- 連不上（沒在跑）時 curl 會立刻失敗，不會等滿逾時。
on serviceIsUp(uiURL, healthURL)
	try
		do shell script "curl -s -o /dev/null --max-time 3 " & quoted form of uiURL
		return true
	end try
	try
		do shell script "curl -s -o /dev/null --max-time 10 " & quoted form of healthURL
		return true
	end try
	return false
end serviceIsUp

-- 上次由這個 app 開 start.command 是不是在 withinSeconds 秒內（看時間戳檔的修改時間）。
on launchedRecently(stampPath, withinSeconds)
	try
		set stampTime to (do shell script "stat -f %m " & quoted form of stampPath) as integer
		set nowTime to (do shell script "date +%s") as integer
		return (nowTime - stampTime) < withinSeconds
	on error
		return false
	end try
end launchedRecently
APPLESCRIPT
}

if [ "${1:-}" = "--print-script" ]; then
  print_script
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || fail "只能在 macOS 上產生 app。"
for tool in osacompile sips iconutil codesign /usr/libexec/PlistBuddy; do
  command -v "$tool" >/dev/null 2>&1 || fail "找不到 macOS 內建工具 $tool。"
done
[ -x "$START_COMMAND" ] || fail "找不到可執行的 $START_COMMAND（需要執行權限）。"
[ -f "$ICON_PNG" ] || fail "找不到圖示來源 $ICON_PNG。"

DEST_DIR="${1:-$HOME/Applications}"
mkdir -p "$DEST_DIR"
DEST_DIR="$(cd "$DEST_DIR" && pwd -P)"
DEST_APP="$DEST_DIR/$APP_NAME.app"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/galley-app.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# 1. AppleScript → app
print_script >"$WORK_DIR/main.applescript"
osacompile -o "$WORK_DIR/$APP_NAME.app" "$WORK_DIR/main.applescript"
BUILT="$WORK_DIR/$APP_NAME.app"
PLIST="$BUILT/Contents/Info.plist"

# 2. 圖示：PNG → iconset → icns
ICONSET="$WORK_DIR/$APP_NAME.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILT/Contents/Resources/applet.icns"

# osacompile 附的 Assets.car＋CFBundleIconName 會蓋過 applet.icns，拿掉才會顯示自己的圖示。
rm -f "$BUILT/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIdentifier" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.galley.launcher" "$PLIST"

# 改過內容，原本的 ad-hoc 簽章失效；重簽一次 ad-hoc（不是正式簽章，只讓系統認得完整性）。
codesign --force --deep --sign - "$BUILT" >/dev/null ||
  fail "codesign 重簽失敗（錯誤訊息見上方），app 沒有產生。"

# 3. 換上新的 app（舊的整個取代）
rm -rf "$DEST_APP"
mv "$BUILT" "$DEST_APP"
# 讓 Finder／Dock 重新讀圖示
touch "$DEST_APP"

echo "已產生：$DEST_APP"
echo "指向的 repo：$REPO_DIR"
echo "把它拖到 Dock 就能用。repo 搬家或改名之後，請在新位置重跑 scripts/make-app.sh。"
