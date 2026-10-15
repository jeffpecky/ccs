/**
 * SVG path calculation utilities for bezier curves
 */

import type { AccountData, AccountZone } from './types';

interface PathCalculationParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  accounts: AccountData[];
}

/**
 * Calculate SVG bezier curve paths from account cards to provider node
 */
export function calculateBezierPaths({
  containerRef,
  svgRef,
  accounts,
}: PathCalculationParams): string[] {
  if (!containerRef.current || !svgRef.current) return [];

  const container = containerRef.current;
  const svg = svgRef.current;
  const svgRect = svg.getBoundingClientRect();

  const destEl = container.querySelector('[data-provider-node]');
  if (!destEl) return [];
  const destRect = destEl.getBoundingClientRect();

  const newPaths: string[] = [];

  accounts.forEach((_, i) => {
    const sourceEl = container.querySelector(`[data-account-index="${i}"]`);
    if (!sourceEl) return;
    const sourceRect = sourceEl.getBoundingClientRect();

    // Determine zone from data attribute
    const zone = (sourceEl.getAttribute('data-zone') || 'left') as AccountZone;

    let startX: number, startY: number, destX: number, destY: number;

    // Note: getBoundingClientRect already includes CSS transforms, so offset is implicit

    switch (zone) {
      case 'right':
        // Right side: connect from left edge of card to right edge of provider
        startX = sourceRect.left - svgRect.left;
        startY = sourceRect.top + sourceRect.height / 2 - svgRect.top;
        destX = destRect.right - svgRect.left;
        destY = destRect.top + destRect.height / 2 - svgRect.top;
        break;
      case 'top':
        // Top side: connect from bottom edge of card to top edge of provider
        startX = sourceRect.left + sourceRect.width / 2 - svgRect.left;
        startY = sourceRect.bottom - svgRect.top;
        destX = destRect.left + destRect.width / 2 - svgRect.left;
        destY = destRect.top - svgRect.top;
        break;
      case 'bottom':
        // Bottom side: connect from top edge of card to bottom edge of provider
        startX = sourceRect.left + sourceRect.width / 2 - svgRect.left;
        startY = sourceRect.top - svgRect.top;
        destX = destRect.left + destRect.width / 2 - svgRect.left;
        destY = destRect.bottom - svgRect.top;
        break;
      default: // 'left'
        // Left side: connect from right edge of card to left edge of provider
        startX = sourceRect.right - svgRect.left;
        startY = sourceRect.top + sourceRect.height / 2 - svgRect.top;
        destX = destRect.left - svgRect.left;
        destY = destRect.top + destRect.height / 2 - svgRect.top;
    }

    // Bezier control points - adjust based on zone direction
    let cp1X: number, cp1Y: number, cp2X: number, cp2Y: number;

    if (zone === 'top' || zone === 'bottom') {
      // Vertical connection - control points extend horizontally for curve
      cp1X = startX;
      cp1Y = startY + (destY - startY) * 0.5;
      cp2X = destX;
      cp2Y = destY - (destY - startY) * 0.5;
    } else {
      // Horizontal connection - control points extend vertically for curve
      cp1X = startX + (destX - startX) * 0.5;
      cp1Y = startY;
      cp2X = destX - (destX - startX) * 0.5;
      cp2Y = destY;
    }

    newPaths.push(`M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${destX} ${destY}`);
  });

  return newPaths;
}
