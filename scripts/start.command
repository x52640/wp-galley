#!/bin/bash
#
# 雙擊啟動發布台。
#
# 在 Finder 裡按兩下就會開一個終端機視窗跑服務，並自動打開瀏覽器。
# 那個終端機視窗**就是服務本體**，關掉視窗或按 Ctrl+C 就是關掉發布台。
#
# 用的是開發模式（npm run dev）：改了程式碼會自動重載，適合現在還在開發的階段。
# 之後專案穩定了想跑得更輕，改成 npm run build && npm start 即可。

set -e
cd "$(dirname "$0")/.."

echo "正在啟動本機 WordPress 發布台…"
echo "（這個視窗就是服務本體，關掉視窗就等於關掉發布台）"
echo

# 前端（Vite，5173）和後端（3000）都起來了才開瀏覽器。
# 只等 Vite 不夠：後端（tsx watch）通常比較慢，這時 Vite 轉不到後端，
# 稿件列表會顯示「後端回應 HTTP 502」，要重新整理才好（P8-T005）。
# 後端第一次啟動可能要套 migration 或搬資料目錄，所以最多等約 2 分鐘。
# 上限照實際經過的秒數算（不是數圈數）：埠接了連線卻不回時，每次 curl 會等滿逾時，數圈數會拖很久。
# 最後一輪若剛好卡在逾時，最多再多十幾秒。
UI_URL="http://127.0.0.1:5173/"
HEALTH_URL="http://127.0.0.1:3000/api/health"
WAIT_SECONDS=120
(
  deadline=$((SECONDS + WAIT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    # -f：後端回 4xx／5xx 也算還沒好，只認 2xx。
    # 後端逾時給 10 秒：剛啟動時 /api/health 要偵測 Agent CLI（還沒有快取），太短會一直重送、每次再偵測一輪。
    if curl -s -o /dev/null --max-time 2 "$UI_URL" &&
      curl -sf -o /dev/null --max-time 10 "$HEALTH_URL"; then
      open "http://127.0.0.1:5173"
      exit 0
    fi
    sleep 0.5
  done
  echo "等了 ${WAIT_SECONDS} 秒服務還沒起來，請看上面的錯誤訊息。"
  echo "（要前端 ${UI_URL} 和後端 ${HEALTH_URL} 都有回應才會自動開瀏覽器）"
) &

exec npm run dev
