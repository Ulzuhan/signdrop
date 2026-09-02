'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Copy, CheckSquare, Square } from 'lucide-react';
import { StampItem } from '@/lib/types';

interface StampItemProps {
  stamp: StampItem;
  isSelected: boolean;
  containerWidth: number;
  containerHeight: number;
  onSelect: () => void;
  onChange: (updated: Partial<StampItem>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export const StampItemOverlay: React.FC<StampItemProps> = ({
  stamp,
  isSelected,
  containerWidth,
  containerHeight,
  onSelect,
  onChange,
  onDelete,
  onDuplicate,
}) => {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; stampX: number; stampY: number } | null>(null);

  // Position in pixels on container
  const leftPx = (stamp.x / 100) * containerWidth;
  const topPx = (stamp.y / 100) * containerHeight;
  const widthPx = (stamp.width / 100) * containerWidth;
  const heightPx = (stamp.height / 100) * containerHeight;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      stampX: stamp.x,
      stampY: stamp.y,
    });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStart) return;
    const deltaX = ((e.clientX - dragStart.x) / containerWidth) * 100;
    const deltaY = ((e.clientY - dragStart.y) / containerHeight) * 100;

    let newX = Math.max(0, Math.min(100 - stamp.width, dragStart.stampX + deltaX));
    let newY = Math.max(0, Math.min(100 - stamp.height, dragStart.stampY + deltaY));

    onChange({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    setDragStart(null);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleResizeStart = (e: React.PointerEvent, corner: 'se' | 'sw' | 'ne' | 'nw') => {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = stamp.width;
    const startH = stamp.height;
    const startStampX = stamp.x;
    const startStampY = stamp.y;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaWPct = ((moveEvent.clientX - startX) / containerWidth) * 100;
      const deltaHPct = ((moveEvent.clientY - startY) / containerHeight) * 100;

      if (corner === 'se') {
        const newW = Math.max(4, Math.min(100 - startStampX, startW + deltaWPct));
        const newH = Math.max(2, Math.min(100 - startStampY, startH + deltaHPct));
        onChange({ width: newW, height: newH });
      } else if (corner === 'sw') {
        const newW = Math.max(4, startW - deltaWPct);
        const newX = startStampX + (startW - newW);
        const newH = Math.max(2, Math.min(100 - startStampY, startH + deltaHPct));
        onChange({ x: newX, width: newW, height: newH });
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={itemRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`sig-stamp-box ${isSelected ? 'selected' : ''}`}
      style={{
        left: `${leftPx}px`,
        top: `${topPx}px`,
        width: `${widthPx}px`,
        height: `${heightPx}px`,
      }}
    >
      {/* Floating Action Menu when selected */}
      {isSelected && (
        <div className="sig-stamp-actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-white"
            title="Duplicar"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-red-500/20 hover:text-red-400"
            title="Eliminar"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      {/* Resize Handles */}
      {isSelected && (
        <>
          <div
            className="sig-handle sig-handle-se"
            onPointerDown={(e) => handleResizeStart(e, 'se')}
          />
          <div
            className="sig-handle sig-handle-sw"
            onPointerDown={(e) => handleResizeStart(e, 'sw')}
          />
        </>
      )}

      {/* Content Rendering */}
      <div className="flex h-full w-full items-center justify-center overflow-hidden p-1">
        {stamp.type === 'signature' || stamp.type === 'initials' ? (
          stamp.content?.startsWith('data:image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stamp.content}
              alt="Firma estampada"
              className="pointer-events-none h-full w-full object-contain"
            />
          ) : (
            <span className="font-sig-caveat text-lg font-bold text-[#003566]">
              {stamp.content || 'Firma'}
            </span>
          )
        ) : stamp.type === 'text' ? (
          <input
            type="text"
            value={stamp.content || ''}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder="Texto..."
            className="w-full bg-transparent px-1 text-xs text-foreground outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : stamp.type === 'date' ? (
          <span className="text-xs font-medium text-foreground">
            {stamp.content || new Date().toISOString().split('T')[0]}
          </span>
        ) : stamp.type === 'checkbox' ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange({ checked: !stamp.checked });
            }}
            className="text-primary"
          >
            {stamp.checked ? <CheckSquare className="size-5" /> : <Square className="size-5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
};
