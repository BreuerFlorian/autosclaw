import { useRef, useCallback, useEffect } from "react";

export function useAutoScroll(deps: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const userScrolled = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = () => { userScrolled.current = true; };
    const onTouchMove = () => { userScrolled.current = true; };
    const onScroll = () => {
      if (userScrolled.current) {
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        autoScroll.current = atBottom;
        userScrolled.current = false;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    if (autoScroll.current && containerRef.current) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, []);

  // Auto-scroll when deps change
  useEffect(() => {
    scrollToBottom();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const resetScroll = useCallback(() => {
    autoScroll.current = true;
    userScrolled.current = false;
  }, []);

  return { containerRef, scrollToBottom, resetScroll };
}
