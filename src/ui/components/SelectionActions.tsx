import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import { describeError } from '../service/client.js';
import type { SelectionSpotsResponse } from '../service/types.js';
import { Icon } from '../icons.js';
import { FcIcon } from './FactcheckIcon.js';
import { SelectionImagePanel } from './SelectionImagePanel.js';
import type { ProofHold } from '../lib/check-while-writing.js';
import {
  capsuleLeft,
  capsuleView,
  imagePanelLeft,
  pickSelection,
  type CapsuleView,
  type PickedSelection,
} from '../lib/selection-actions.js';
import { selectionImageHeading, selectionPickStale, settleSpots } from '../lib/selection-image-view.js';

/**
 * 選字之後浮出的那排按鈕（P5-T041 從 ProofView 抽出）：查證這句（P6-T005，D-034；打字模式 D-036）、
 * 用此段配圖（P5-T038，D-037）。之後要在膠囊上多加按鈕，改這個檔就好。
 *
 * - `useSelectionActions`：選了什麼、膠囊與面板開關、按下去之後的流程（打字模式先存再做 `actWhileWriting`、
 *   問位置的請求編號、面板過期就關掉並講原因）。
 * - `SelectionActions`：膠囊與「用此段配圖」面板，畫在 iframe 外層、用文件座標定位。
 * - `SelectionNotice`：面板因為文章被別處改了而關掉時，頂端那一行提示。
 *
 * iframe 載入時由 `useProofFrame` 的 `handleLoad` 把選取事件交給它（`attach`），版本換掉、開始打字時收起膠囊（`clearPick`）；ProofView 只負責接線。
 * 「先存再做」本身（`actWhileWriting`）跟「儲存」共用存檔狀態與「照樣存」，在 `lib/use-proof-editing.ts`，由這裡呼叫。
 */

/** 上層給的「查證這句」（P6-T005）。null＝不給（對照、成品、改字中、稿件結束）。 */
export interface SelectionCheckInput {
  blockedReason: string | null;
  note: string | null;
  onCheck: (text: string) => void;
}

/**
 * 上層給的「用此段配圖」（P5-T038）。null＝不給。`blockedReason` 不是 null 時照樣出現但反灰、講原因。
 * 位置選項由後端在存好的那一版上算（`loadSpots`，第二輪審查）：打字模式由這裡先自動存，再問選項。
 * `loadSpots` 換篇時回 null（不顯示）；錯誤丟出來，面板上講。`onRequest` 自己接住錯誤（講在頂端），這裡只等它結束。
 * `currentHash`：畫面知道的目前版本（打字中最後存的那一版，否則工作區的版本）；不是選項來源那一版就關掉面板請重選。
 */
export interface SelectionImageInput {
  blockedReason: string | null;
  currentHash: string | undefined;
  loadSpots: (text: string) => Promise<SelectionSpotsResponse | null>;
  onRequest: (input: { text: string; note: string | null; spot: number; contentHash: string }) => Promise<void>;
}

/** 「用此段配圖」打開的面板：選的那段、畫在哪、後端給的位置選項（`spots` 是 null＝還在問）。 */
interface ImagePick {
  /** 這次打開的請求編號（`settleSpots`）。 */
  token: number;
  text: string;
  top: number;
  left: number;
  /** 後端回的位置選項與它用的那一版；送出時原樣帶回。 */
  spots: SelectionSpotsResponse['spots'] | null;
  spotsHash: string | null;
  loadError: string | null;
  /** 打開時校樣是哪一版：之後被別處改了就關掉請重選（Codex 審查 P2）。 */
  openedKey: string;
}

export interface SelectionActionsState {
  /** 把選取事件掛到剛載入的校樣文件上（選了字就浮出膠囊、Esc 收起）。身分不變，可以放進 useCallback。 */
  attach: (doc: Document) => void;
  /** 收起膠囊（版本換掉、開始打字）。身分不變。 */
  clearPick: () => void;
  /** 面板因為文章被別處改了而關掉時要講的話。 */
  notice: string | null;
  dismissNotice: () => void;
  /** 膠囊：null＝不畫。 */
  capsule: (CapsuleView & { picked: PickedSelection }) | null;
  /** 「用此段配圖」面板：null＝不畫。 */
  panel: { pick: ImagePick; blockedReason: string | null } | null;
  imageSending: boolean;
  check: () => void;
  openImage: () => void;
  sendImage: (input: { note: string | null; spot: number }) => void;
  closeImage: () => void;
}

export function useSelectionActions({
  jobUuid,
  mode,
  isEditing,
  revisionKey,
  hold,
  frameRef,
  selectionCheck,
  selectionImage,
  actWhileWriting,
}: {
  jobUuid: string;
  mode: 'edit' | 'final';
  isEditing: boolean;
  /** 校樣目前是哪一版（`contentHash`，沒有版本是 `none`）。 */
  revisionKey: string;
  /** 打字中自己存的那幾版（D-036）：不算「被別處改了」。 */
  hold: ProofHold | null;
  frameRef: RefObject<HTMLIFrameElement | null>;
  selectionCheck: SelectionCheckInput | null;
  selectionImage: SelectionImageInput | null;
  /** 打字模式：內容有改就先照「儲存」存一版，存好再做（`useProofEditing`）。 */
  actWhileWriting: (act: () => void | Promise<void>) => Promise<void>;
}): SelectionActionsState {
  /** 選字查證：選了哪段字、膠囊畫在哪（文件座標）。null＝沒選或不給查。 */
  const [picked, setPicked] = useState<PickedSelection | null>(null);
  const [imagePick, setImagePick] = useState<ImagePick | null>(null);
  /** 面板因為文章被別處改了而關掉時要講的話。 */
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const [imageSending, setImageSending] = useState(false);
  /** 「用此段配圖」每次打開面板加一（`settleSpots` 的 token）。 */
  const pickToken = useRef(0);
  const selectionCheckRef = useRef(selectionCheck);
  selectionCheckRef.current = selectionCheck;
  const selectionImageRef = useRef(selectionImage);
  selectionImageRef.current = selectionImage;
  /** 目前是哪一篇：問位置的回應回來時不是發起那一篇就不寫（Workspace 換篇沿用這個元件，第二輪審查）。 */
  const jobUuidRef = useRef(jobUuid);
  jobUuidRef.current = jobUuid;

  const attach = useCallback((doc: Document) => {
    // 選字查證（P6-T005；打字模式也算，D-036）：上層有給的時候，選了字就在選取下方浮出「查證這句」。
    // 選取消失（打字會把選取收成游標）就收起。
    doc.addEventListener('selectionchange', () => {
      if (selectionCheckRef.current == null) return;
      setPicked(pickSelection(doc));
    });
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setPicked(null);
    });
  }, []);
  const clearPick = useCallback(() => setPicked(null), []);

  // 不給選字查證了（進了對照、打開發布面板…）就把膠囊收掉。打字模式照樣給（D-036）。
  const canPick = selectionCheck !== null && mode === 'edit';
  useEffect(() => {
    if (!canPick) setPicked(null);
  }, [canPick]);
  useEffect(() => {
    if (!canPick || selectionImage === null) setImagePick(null);
  }, [canPick, selectionImage === null]);

  // 換篇：面板與提示都收掉（第二輪審查）。
  useEffect(() => {
    setImagePick(null);
    setPickNotice(null);
  }, [jobUuid]);

  /**
   * 按「用此段配圖」：打開面板，問後端在存好的那一版上算位置選項（打字模式在這之前已先自動存）。
   * 回來時不是同一次打開（關掉又開、換篇）就不寫。
   */
  const openImagePick = (pick: { text: string; top: number; left: number }): void => {
    const load = selectionImageRef.current?.loadSpots;
    if (load === undefined) return;
    const origin = jobUuid;
    // 每次打開一個新的請求編號：關掉又重開同一段時，舊請求的結果（成功或失敗）對不上就丟掉（第五輪審查）。
    const token = (pickToken.current += 1);
    setPickNotice(null);
    setImagePick({ ...pick, token, spots: null, spotsHash: null, loadError: null, openedKey: revisionKey });
    void load(pick.text).then(
      (result) => {
        if (result === null || jobUuidRef.current !== origin) return;
        setImagePick((current) => settleSpots(current, token, { ok: true, result }));
      },
      (cause: unknown) => {
        if (jobUuidRef.current !== origin) return;
        setImagePick((current) => settleSpots(current, token, { ok: false, error: describeError(cause) }));
      },
    );
  };

  // 面板開著時文章被別處改了，或位置選項來源那一版已經不是目前這一版：選項是照舊版算的，關掉請重選。
  useEffect(() => {
    if (imagePick === null) return;
    if (
      selectionPickStale({
        spotsHash: imagePick.spotsHash,
        currentHash: selectionImage?.currentHash,
        openedKey: imagePick.openedKey,
        currentKey: revisionKey,
        own: hold?.own ?? [],
        sending: imageSending,
      })
    ) {
      setImagePick(null);
      setPickNotice('文章剛被改過，「用此段配圖」的位置可能不對了，請重新選一次那段。');
    }
  }, [revisionKey, imagePick, hold, imageSending, selectionImage?.currentHash]);

  /** 送出：帶回後端給的 `spot` 與選項來源那一版的 `contentHash`（不是那一版後端回 409）。不再先存（打開時存過了）。 */
  const sendImage = (input: { note: string | null; spot: number }): void => {
    const pick = imagePick;
    const request = selectionImageRef.current?.onRequest;
    if (pick === null || pick.spotsHash === null || request === undefined) return;
    setImageSending(true);
    void request({ text: pick.text, note: input.note, spot: input.spot, contentHash: pick.spotsHash }).finally(() => {
      setImageSending(false);
      setImagePick(null);
    });
  };

  const check = (): void => {
    if (picked === null) return;
    const text = picked.text;
    setPicked(null);
    const selection = frameRef.current?.contentDocument?.getSelection();
    if (isEditing) {
      // 打字模式：游標留在選的那段字後面，接著打（D-036）。
      selection?.collapseToEnd();
      void actWhileWriting(() => selectionCheckRef.current?.onCheck(text));
      return;
    }
    selection?.removeAllRanges();
    selectionCheck?.onCheck(text);
  };

  const openImage = (): void => {
    if (picked === null) return;
    const pick = { text: picked.text, top: picked.top, left: picked.left };
    setPicked(null);
    const selection = frameRef.current?.contentDocument?.getSelection();
    // 打字模式游標留在選的那段字後面；看文章模式清掉選取（面板接手）。
    if (isEditing) {
      selection?.collapseToEnd();
      // 打字模式：先照「儲存」自動存一版，再問後端在那一版上的位置（第二輪審查）。
      void actWhileWriting(() => openImagePick(pick));
      return;
    }
    selection?.removeAllRanges();
    openImagePick(pick);
  };

  return {
    attach,
    clearPick,
    notice: pickNotice,
    dismissNotice: () => setPickNotice(null),
    capsule:
      canPick && picked !== null
        ? { picked, ...capsuleView(picked, selectionCheck, selectionImage) }
        : null,
    panel:
      canPick && imagePick !== null && selectionImage !== null
        ? { pick: imagePick, blockedReason: selectionImage.blockedReason }
        : null,
    imageSending,
    check,
    openImage,
    sendImage,
    closeImage: () => setImagePick(null),
  };
}

/** 膠囊與「用此段配圖」面板（畫在校樣那張紙上，跟 iframe 同一套文件座標）。 */
export function SelectionActions({
  actions,
  editing,
  saving,
}: {
  actions: SelectionActionsState;
  editing: boolean;
  saving: boolean;
}): JSX.Element {
  const { capsule, panel, imageSending } = actions;
  return (
    <>
      {capsule !== null && (
        <div className="fc-pick-layer">
          <div
            className="fc-pick"
            role="group"
            aria-label="選的字"
            style={{ top: `${capsule.picked.top}px`, left: `${capsuleLeft(capsule.picked.left, capsule.imageShown)}px` }}
          >
            <div className="fc-pick-row">
            <button
              type="button"
              className="fc-pick-btn"
              disabled={capsule.checkProblem !== null || saving}
              onMouseDown={(event) => event.preventDefault()}
              onClick={actions.check}
            >
              <FcIcon name="search-check" size={13} />
              查證這句
            </button>
            {capsule.imageShown && (
              <button
                type="button"
                className="fc-pick-btn"
                data-kind="image"
                disabled={capsule.imageProblem !== null || saving || imageSending}
                onMouseDown={(event) => event.preventDefault()}
                onClick={actions.openImage}
              >
                <Icon name="image-plus" size={13} />
                用此段配圖
              </button>
            )}
            </div>
            {capsule.notes.map((note) => (
              <span key={note.text} className="fc-pick-note" data-tone={note.tone}>
                {note.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {panel !== null && (
        <div className="fc-pick-layer">
          <div className="sel-image-pop" style={{ top: `${panel.pick.top}px`, left: `${imagePanelLeft(panel.pick.left)}px` }}>
            <SelectionImagePanel
              // 每次打開都是全新的面板（第六輪審查）：位置回到預設「這段開頭」、那句話清空，不沿用上一次的選擇。
              key={panel.pick.token}
              heading={selectionImageHeading(panel.pick.text)}
              spots={panel.pick.spots}
              loadError={panel.pick.loadError}
              blockedReason={panel.blockedReason}
              editing={editing}
              busy={imageSending || saving}
              onSend={actions.sendImage}
              onClose={actions.closeImage}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** 面板因為文章被別處改了而關掉時，校樣頂端的提示。 */
export function SelectionNotice({ actions }: { actions: SelectionActionsState }): JSX.Element | null {
  if (!actions.notice) return null;
  return (
    <p className="proof-status proof-status-warn" role="status">
      <Icon name="alert" size={15} /> {actions.notice}
      <button type="button" className="btn btn-quiet btn-tiny" onClick={actions.dismissNotice}>
        知道了
      </button>
    </p>
  );
}
