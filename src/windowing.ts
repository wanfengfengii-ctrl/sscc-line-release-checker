import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 行高的首帧估算值（px），首帧提交后立即改为真实测量值。 */
const FALLBACK_ROW_HEIGHT = 37;
/** 视口上下各额外挂载的行数；视口约 20 行时挂载总数恒小于 120。 */
const BUFFER_ROWS = 40;
/**
 * 视口高度的首帧兜底值。首批行提交前容器还没有内容高度，
 * 用它先算出一个覆盖视口的窗口，让数据行与底部填充行在同一帧挂载，
 * 滚动容器即刻具备完整的可滚动高度（scrollTop 不会被夹成 0）。
 */
const FALLBACK_VIEWPORT_HEIGHT = 600;

export interface RowWindow {
  /** 当前挂载行在结果数组中的起始下标。 */
  startIndex: number;
  /** 当前挂载行在结果数组中的结束下标（不含）。 */
  endIndex: number;
  /** 顶部填充行高度（px），撑起已滚走区域的滚动条。 */
  topSpacerHeight: number;
  /** 底部填充行高度（px），撑起未滚到区域的滚动条。 */
  bottomSpacerHeight: number;
}

function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  count: number,
  rowHeight: number,
): RowWindow {
  if (count === 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight));
  const startIndex = Math.max(0, firstVisible - BUFFER_ROWS);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + 1;
  const endIndex = Math.min(count, firstVisible + visibleCount + BUFFER_ROWS);
  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: (count - endIndex) * rowHeight,
  };
}

/**
 * 结果行窗口化：无论批次有多少行，DOM 只挂载视口与缓冲区范围内的数据行，
 * 上下以两个填充 tr 撑起完整滚动高度。行高从真实挂载行测量，不写死估算。
 *
 * `resetKey` 变化（新批次提交）时滚动位置回到顶部；输入被修改时结果整体
 * 卸载，窗口状态随之消失。
 *
 * `scrollToIndex` 仅在目标行不在视口内时最小幅度滚动。目标行尚未挂载时，
 * 滚动触发窗口重算挂载新行，由调用方的挂载聚焦逻辑在行 DOM 出现后补焦。
 */
export function useRowWindow(
  count: number,
  resetKey: unknown,
): {
  containerRef: RefObject<HTMLDivElement>;
  rowWindow: RowWindow;
  scrollToIndex: (index: number) => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW_HEIGHT);
  // 真实行高是否已测得；未测得时待处理跳转只记录，待行高修正后补滚
  const [measured, setMeasured] = useState(false);
  const [rowWindow, setRowWindow] = useState<RowWindow>(() =>
    computeWindow(0, FALLBACK_VIEWPORT_HEIGHT, count, FALLBACK_ROW_HEIGHT),
  );

  // 最新值供稳定回调读取
  const stateRef = useRef({ count, rowHeight });
  stateRef.current = { count, rowHeight };

  const wantedIndexRef = useRef<number | null>(null);

  const recalc = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const { count: currentCount, rowHeight: currentHeight } = stateRef.current;
    setRowWindow(
      computeWindow(
        el.scrollTop,
        el.clientHeight || FALLBACK_VIEWPORT_HEIGHT,
        currentCount,
        currentHeight,
      ),
    );
  }, []);

  // 新批次：回到顶部，先用兜底视口算窗口（行与底部填充同帧挂载，立即可滚动）
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    wantedIndexRef.current = null;
    setMeasured(false);
    el.scrollTop = 0;
    setRowHeight(FALLBACK_ROW_HEIGHT);
    setRowWindow(computeWindow(0, FALLBACK_VIEWPORT_HEIGHT, count, FALLBACK_ROW_HEIGHT));
  }, [count, resetKey]);

  // 窗口每次变化后（重新）测量真实行高并重算：首批行可能在本次提交才挂载
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) {
      const sample = el.querySelector<HTMLTableRowElement>('tbody tr[data-row-index]');
      const measuredHeight = sample?.getBoundingClientRect().height;
      if (measuredHeight && measuredHeight > 0) {
        setMeasured(true);
        if (Math.abs(measuredHeight - stateRef.current.rowHeight) > 0.5) {
          setRowHeight(measuredHeight);
        }
      }
      setRowWindow(
        computeWindow(
          el.scrollTop,
          el.clientHeight || FALLBACK_VIEWPORT_HEIGHT,
          stateRef.current.count,
          stateRef.current.rowHeight,
        ),
      );
    }
  }, [rowWindow.startIndex, rowWindow.endIndex, count, resetKey, rowHeight]);

  // 行高首次测得或被修正后，待处理目标可能按估算坐标滚偏，按真实坐标补滚一次
  useLayoutEffect(() => {
    if (!measured) {
      return;
    }
    const wanted = wantedIndexRef.current;
    const el = containerRef.current;
    if (wanted === null || !el) {
      return;
    }
    const height = stateRef.current.rowHeight;
    const rowTop = wanted * height;
    const rowBottom = rowTop + height;
    if (rowTop >= el.scrollTop && rowBottom <= el.scrollTop + el.clientHeight) {
      wantedIndexRef.current = null; // 目标已按真实坐标位于视口内，不再干预用户滚动
      return;
    }
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else {
      el.scrollTop = rowBottom - el.clientHeight;
    }
    setRowWindow(
      computeWindow(el.scrollTop, el.clientHeight, stateRef.current.count, height),
    );
  }, [measured, rowHeight, count, resetKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(recalc);
    observer.observe(el);
    return () => observer.disconnect();
  }, [recalc, resetKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    el.addEventListener('scroll', recalc, { passive: true });
    return () => el.removeEventListener('scroll', recalc);
  }, [recalc, resetKey]);

  const scrollToIndex = useCallback((index: number) => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    wantedIndexRef.current = index;
    const height = stateRef.current.rowHeight;
    const rowTop = index * height;
    const rowBottom = rowTop + height;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - (el.clientHeight || FALLBACK_VIEWPORT_HEIGHT);
    }
    // 同步重算，不等待 scroll 事件入队
    setRowWindow(
      computeWindow(
        el.scrollTop,
        el.clientHeight || FALLBACK_VIEWPORT_HEIGHT,
        stateRef.current.count,
        height,
      ),
    );
  }, []);

  return { containerRef, rowWindow, scrollToIndex };
}

/**
 * 在目标问题行挂载后聚焦。
 *
 * 跳向屏外问题行时先滚动触发窗口重算，行 DOM 在新窗口提交后才出现，
 * 因此这里在每次窗口变化后重试，直到聚焦成功一次；成功后不再因用户
 * 自行滚动而抢焦点。目标为 null（无问题行）时不移动焦点，保留提交后
 * 焦点停在按钮上的原有语义。
 */
export function useFocusMountedRow(
  rowRefs: RefObject<Map<number, HTMLTableRowElement>>,
  targetLineNumber: number | null,
  windowStart: number,
  windowEnd: number,
) {
  const pendingRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    pendingRef.current = targetLineNumber;
  }, [targetLineNumber]);

  useLayoutEffect(() => {
    const target = pendingRef.current;
    if (target === null) {
      return;
    }
    const node = rowRefs.current?.get(target);
    if (node) {
      node.focus();
      pendingRef.current = null; // 仅补焦到成功为止，不劫持后续滚动
    }
  }, [targetLineNumber, windowStart, windowEnd, rowRefs]);
}
