---
id: P5-T006
phase: 5
status: in_progress
depends_on: [P5-T003]
specs: [design-system.md, review-proposals.md, agent-tasks.md]
write_paths: ["src/ui/", "tests/", "docs/specs/design-system.md", "docs/specs/review-proposals.md"]
contract_change: none
expected_commit: "feat(P5-T006): 工作區改為文件式（B1）"
---

# UI 改版為 B 版（二）：B1 工作區

## 目標
D-013。設計稿 B1：文章在中間，建議標在字上，右側卡片一對一對應；上方一顆「請 AI 看一遍」、
一顆「發布…」。

## 範圍
### 包含
- 頂列：返回、類型、標題、檢視切換（編輯／對照／成品）、AI 按鈕（一鍵校驗＋選單）、發布…
- 校樣上標出建議的位置；右欄建議卡片（分類篩選、接受／保留原文／自己改、錯字一次全改）
- 右欄的圖片區（沿用配圖面板）；「改原文」抽屜（沿用原稿面板）
- 拿掉左狀態軌與右側步驟卡片
### 不包含
- 發布面板（P5-T007）；在那之前「發布…」打開舊的核准＋發布卡片

## 實作要求
- 校樣仍在 sandbox iframe 裡（安全模型不變）；標記由外層量位置後畫在 iframe 外，或以 CSSOM 加在文件內，不注入 script。
- 配圖建議放右欄，不插進段落之間：Agent 給的 placement 是文字描述，不是段落編號。

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：Workspace 版面骨架
- Blocker：無

## 完成結果
