import { useRef, useEffect, useCallback } from "react";

const EDGE_THRESHOLD = 30;
const SWIPE_MIN = 80;
const SWIPE_MAX_Y = 50;

export function useSwipeBack(onBack: () => void) {
  const startX = useRef(0);
  const startY = useRef(0);
  const isEdge = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch.clientX <= EDGE_THRESHOLD) {
      isEdge.current = true;
      startX.current = touch.clientX;
      startY.current = touch.clientY;
    } else {
      isEdge.current = false;
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!isEdge.current) return;
    isEdge.current = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX.current;
    const dy = Math.abs(touch.clientY - startY.current);
    if (dx >= SWIPE_MIN && dy <= SWIPE_MAX_Y) {
      onBack();
    }
  }, [onBack]);

  useEffect(() => {
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);
}
