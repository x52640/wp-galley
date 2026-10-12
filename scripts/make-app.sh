#!/bin/bash
#
# 產生 Galley.app：放在 Dock 上、點一下就能開發布台的小 app（D-044 P8-T005；D-046 P8-T006 改成背景執行）。
#
#   scripts/make-app.sh              產生到 ~/Applications/Galley.app
#   scripts/make-app.sh <資料夾>      產生到 <資料夾>/Galley.app
#   scripts/make-app.sh --print-script   只印出 app 裡的 AppleScript（測試用），不產生 app
#
# Galley.app 是常開的 applet（osacompile -s），不開終端機：
#   - 打開：沒在跑 → 用 scripts/galley-service.sh 在背景起服務，前後端都通了才開瀏覽器；
#           之前由 Galley 起、Galley 當掉留下的 → 接手；由 start.command（終端機）開的 → 只開瀏覽器、不接手，Galley 自己結束
#   - 點 Dock 圖示：開瀏覽器
#   - ⌘Q／Dock 右鍵結束／登出：關掉 Galley 起的（或接手的）服務，兩個埠都放掉才結束
#
# repo 的絕對路徑在產生 app 時寫死進去。repo 搬家或改名之後，重跑一次這個腳本即可。
# 只用 macOS 內建工具（osacompile、sips、iconutil、PlistBuddy、codesign），不下載任何東西。
# 圖示來源是 scripts/app/icon.png（1024×1024），想換圖示就蓋掉它再重跑。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SERVICE_SCRIPT="$REPO_DIR/scripts/galley-service.sh"
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
-- 常開的 applet（osacompile -s）：Dock 上有亮點＝發布台開著；⌘Q、Dock 右鍵結束、登出都會把背景服務關掉。
-- 服務的起停都交給 scripts/galley-service.sh（不開終端機，輸出寫到資料目錄的 logs/galley.log）。
-- 不用 property：applet 執行後會把 property 寫回腳本檔，弄壞簽章。

on run
	set svc to serviceScript()
	try
		do shell script "test -x " & quoted form of svc
	on error
		display dialog "找不到服務腳本：" & return & svc & return & return & "repo 搬家或改名了嗎？請在新位置重跑 scripts/make-app.sh。" buttons {"好"} default button 1 with title "Galley" with icon caution
		quit
		return
	end try
	set serviceState to do shell script quoted form of svc & " status"
	if serviceState is "other" then
		-- start.command（終端機）開的：只開瀏覽器，不接手，Galley 也不留著（結束 Galley 不會關它）。
		display notification "發布台已經在跑（多半是從終端機 start.command 開的）：Galley 只幫你打開瀏覽器，不會關它；要關請到那個終端機視窗。" with title "Galley"
		open location uiURL()
		quit
		return
	end if
	launchService(svc, serviceState)
end run

-- 點 Dock 圖示：Galley 起的服務還在（或是別人開的）→ 再開一次瀏覽器（分頁關掉了也找得回來）；
-- 服務自己掛掉了（stopped，Dock 亮點還在）→ 照開啟時的流程重起。
on reopen
	set svc to serviceScript()
	set serviceState to "ours"
	try
		set serviceState to do shell script quoted form of svc & " status"
	end try
	if serviceState is "stopped" then
		launchService(svc, serviceState)
	else
		open location uiURL()
	end if
end reopen

-- 起服務（沒在跑）或接手（之前由 Galley 起、Galley 當掉留下來的），等前後端都通才開瀏覽器。
-- do shell script 會一直等到腳本結束（最多約兩分鐘多），不受 Apple event 的逾時影響，不必另外放寬。
-- 這段期間 app 在等：⌘Q、登出要等它做完才處理（登出可能因此被擋下，見 known-issues）。
-- 起不來：對話框講原因與記錄檔位置，Galley 結束（亮點消失＝沒有在跑）。
on launchService(svc, serviceState)
	if serviceState is not "ours" then display notification "正在背景啟動發布台，好了會自動打開瀏覽器。" with title "Galley"
	try
		do shell script quoted form of svc & " start"
	on error errMsg
		set choice to display dialog "發布台沒有起來：" & return & return & errMsg buttons {"打開記錄檔", "好"} default button 2 with title "Galley" with icon caution
		if button returned of choice is "打開記錄檔" then
			try
				do shell script "open -a Console " & quoted form of (do shell script quoted form of svc & " logpath")
			end try
		end if
		quit
		return false
	end try
	open location uiURL()
	return true
end launchService

-- ⌘Q、Dock 右鍵結束、登出／關機：先把 Galley 起的（或接手的）整棵服務程序樹關掉、埠放掉，才真的結束。
-- stop 是同步的（do shell script 等它跑完），回來才 continue quit。
-- 不是 Galley 起的（start.command）不會碰。關不乾淨也要能結束（不然登出會卡住），只跳通知。
on quit
	try
		do shell script quoted form of serviceScript() & " stop"
	on error errMsg
		display notification errMsg with title "Galley"
	end try
	continue quit
end quit

on serviceScript()
	set repoPath to $(applescript_string "$REPO_DIR")
	return repoPath & "/scripts/galley-service.sh"
end serviceScript

on uiURL()
	return "http://127.0.0.1:5173"
end uiURL
APPLESCRIPT
}

if [ "${1:-}" = "--print-script" ]; then
  print_script
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || fail "只能在 macOS 上產生 app。"
for tool in osacompile sips iconutil codesign /usr/libexec/PlistBuddy; do
  command -v "$tool" >/dev/null 2>&1 || fail "找不到 macOS 內建工具 ${tool}。"
done
[ -x "$SERVICE_SCRIPT" ] || fail "找不到可執行的 ${SERVICE_SCRIPT}（需要執行權限）。"
[ -f "$ICON_PNG" ] || fail "找不到圖示來源 ${ICON_PNG}。"

DEST_DIR="${1:-$HOME/Applications}"
mkdir -p "$DEST_DIR"
DEST_DIR="$(cd "$DEST_DIR" && pwd -P)"
DEST_APP="$DEST_DIR/$APP_NAME.app"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/galley-app.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# 1. AppleScript → app
print_script >"$WORK_DIR/main.applescript"
osacompile -s -o "$WORK_DIR/$APP_NAME.app" "$WORK_DIR/main.applescript"
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
