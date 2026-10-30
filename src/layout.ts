import type { Page } from 'playwright';

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface LayoutMetrics {
  viewport: { width: number; height: number };
  document: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
  overlays: Array<{
    selector: string;
    rect: LayoutRect;
    body?: LayoutRect;
    footer?: LayoutRect;
  }>;
}

export interface LayoutFinding {
  id: string;
  message: string;
  actual: unknown;
}

export async function collectLayoutMetrics(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const rect = (element: Element): LayoutRect => {
      const box = element.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
      };
    };
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    const overlays = [...document.querySelectorAll('.ant-modal-wrap .ant-modal, .ant-drawer-content-wrapper, [role="dialog"][aria-modal="true"]')]
      .filter(visible)
      .map((element) => {
        const modal = element.matches('.ant-modal');
        const body = element.querySelector(modal ? '.ant-modal-body' : '.ant-drawer-body');
        const footer = element.querySelector(modal ? '.ant-modal-footer' : '.ant-drawer-footer');
        return {
          selector: modal ? '.ant-modal' : element.matches('.ant-drawer-content-wrapper') ? '.ant-drawer-content-wrapper' : '[role="dialog"]',
          rect: rect(element),
          ...(body && visible(body) ? { body: rect(body) } : {}),
          ...(footer && visible(footer) ? { footer: rect(footer) } : {}),
        };
      });
    return {
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
      overlays,
    };
  });
}

export function inspectLayout(metrics: LayoutMetrics): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  if (metrics.document.scrollWidth > metrics.document.clientWidth + 1) {
    findings.push({
      id: 'page-horizontal-overflow',
      message: '页面横向内容超出可视宽度。',
      actual: { scrollWidth: metrics.document.scrollWidth, clientWidth: metrics.document.clientWidth },
    });
  }
  for (const [index, overlay] of metrics.overlays.entries()) {
    const { rect, footer, body } = overlay;
    const viewport = metrics.viewport;
    if (rect.x < -1 || rect.y < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
      findings.push({ id: `overlay-outside-viewport-${index + 1}`, message: `${overlay.selector} 超出浏览器视口。`, actual: { rect, viewport } });
    }
    if (footer && (footer.y < -1 || footer.bottom > viewport.height + 1)) {
      findings.push({ id: `overlay-footer-outside-viewport-${index + 1}`, message: `${overlay.selector} 的底部操作区不在视口内。`, actual: { footer, viewport } });
    }
    if (body && footer && body.bottom > footer.y + 1) {
      findings.push({ id: `overlay-body-footer-overlap-${index + 1}`, message: `${overlay.selector} 正文与底部操作区发生重叠。`, actual: { body, footer } });
    }
  }
  return findings;
}
