import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as d3 from 'd3';
import { MindNode, ViewState, Theme } from '../types';
import { getContrastingTextColor, getSmartBorderColor } from '../utils/helpers';
import { useMindMapLayout } from './useMindMapLayout';
import { useMindMapInteraction } from './useMindMapInteraction';
import { CircleHelp, X, Keyboard, MousePointer2, Command, CornerDownLeft, ArrowRightLeft, Focus } from 'lucide-react';


interface MindMapProps {
  data: MindNode;
  viewState: ViewState;
  theme: Theme;
  onChange: (newData: MindNode) => void;
  onViewStateChange: (newState: ViewState) => void;
  isActive: boolean;
  onHelpToggle?: (isOpen: boolean) => void;
}

const HELP_STORAGE_KEY = 'mindflow_help_open';

// We use forwardRef to expose internal state control (like closing help) to parent if needed
export interface MindMapHandle {
  setHelpOpen: (open: boolean) => void;
  centerView: (id?: string | null, clearFocus?: boolean, preserveScale?: boolean, x?: number, y?: number) => void;
}

const MindMap = forwardRef<MindMapHandle, MindMapProps>(({ data, viewState, theme, onChange, onViewStateChange, isActive, onHelpToggle }, ref) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const layoutCache = useRef<any[]>([]);

  // Help Module State (Persistent)
  const [isHelpOpen, setIsHelpOpen] = useState(() => {
    try {
      return localStorage.getItem(HELP_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Notify parent on help state change
  useEffect(() => {
    onHelpToggle?.(isHelpOpen);
  }, [isHelpOpen, onHelpToggle]);

  const toggleHelp = () => {
    setIsHelpOpen(prev => {
      const newState = !prev;
      localStorage.setItem(HELP_STORAGE_KEY, String(newState));
      return newState;
    });
  };

  const {
    layoutNodes,
    centerView,
    autoPan
  } = useMindMapLayout({
    internalData: data,
    svgRef,
    wrapperRef,
    viewState,
    theme,
    isSelecting: false,
    onViewStateChange,
  });

  useImperativeHandle(ref, () => ({
    setHelpOpen: (open: boolean) => {
      setIsHelpOpen(open);
      localStorage.setItem(HELP_STORAGE_KEY, String(open));
    },
    centerView
  }));

  // Update layout cache when nodes change
  useEffect(() => {
    layoutCache.current = layoutNodes;
  }, [layoutNodes]);

  const {
    internalData,
    editingId,
    selectedIds,
    isSelecting,
    selectionRect,
    draggedNodeId,
    dropTarget,
    handleTextChange,
    handleTextBlur,
    handleInputKeyDown,
    handleInputDoubleClick,
    handleInputSelect,
    handleNodeClick,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDrop,
    handleCanvasDragOver,
    handleCanvasDrop,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,


  } = useMindMapInteraction({
    data,
    viewState,
    isActive,
    onChange,
    onViewStateChange,
    centerView,
    autoPan,
    wrapperRef,
    svgRef,
    layoutCache,
  });

  // Recalculate layout based on the state from the interaction hook
  const { layoutNodes: currentLayoutNodes } = useMindMapLayout({
    internalData, // Use the state managed by the interaction hook
    svgRef,
    wrapperRef,
    viewState,
    theme,
    isSelecting, // Pass the actual isSelecting state
    onViewStateChange,
  });

  // --- Initial Centering ---
  useEffect(() => {
    if (viewState.needsCentering) {
      // Small delay to ensure D3/DOM is ready on first mount
      const timer = setTimeout(() => {
        // If it is Tree mode (portrait), we center at top left (offset) to avoid create button
        if (viewState.layout === 'tree') {
          // Create button is at top: 24px + 24px + padding -> approx 80px.
          // Let's position root at (100, 100) on screen.
          centerView(viewState.focusedNodeId, false, false, 120, 120);
        } else {
          centerView(viewState.focusedNodeId, false);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewState.needsCentering, centerView, viewState.focusedNodeId, viewState.layout]);


  return (
    <div
      ref={wrapperRef}
      className="w-full h-full relative overflow-hidden select-none transition-colors duration-500"
      style={{ backgroundColor: theme.background }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <svg ref={svgRef} className="w-full h-full absolute top-0 left-0 cursor-default active:cursor-grabbing">
        <g className="mindmap-group pointer-events-auto">
          <g className="links"></g>
          <g className="nodes"></g>
          {currentLayoutNodes.map((node) => {
            const isFocused = editingId === node.data.id;
            const isSelected = selectedIds.has(node.data.id);
            const isRoot = !!node.data.isRoot;
            const bgColor = theme.nodeColors[node.depth % theme.nodeColors.length];
            const borderColor = getSmartBorderColor(bgColor);
            const textColor = getContrastingTextColor(bgColor);
            const width = node.width;
            // Use calculated actualHeight or fallback
            const height = node.actualHeight || 40;

            let isHidden = false;
            if (selectedIds.size <= 1 && draggedNodeId === node.data.id) {
              isHidden = true;
            }

            const isDropTarget = dropTarget?.nodeId === node.data.id;
            const dropPos = isDropTarget ? dropTarget?.position : null;

            return (
              <foreignObject
                key={node.data.id}
                x={node.y - 10}
                y={node.x - height / 2} // Center vertically
                width={width + 20}
                height={height}
                className={`overflow-visible transition-opacity duration-300 ${isHidden ? 'opacity-20' : 'opacity-100'}`}
              >
                <div
                  className="h-full flex items-center justify-center"
                  draggable={!isRoot}
                  onDragStart={(e) => handleDragStart(e, node.data.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, node.data.id, isRoot)}
                  onDrop={(e) => handleDrop(e, node.data.id, isRoot)}
                  onClick={(e) => handleNodeClick(e, node.data.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className={`
                        relative flex items-center justify-center px-4 py-2 rounded-lg shadow-sm transition-[transform,box-shadow,border-color,background-color] duration-300 border
                        ${isFocused ? 'ring-2 ring-white scale-105 z-20 shadow-lg' : 'hover:scale-105 z-10 cursor-pointer'}
                        ${isSelected && !isFocused ? 'ring-2 ring-cyan-400 z-10' : ''}
                        ${isDropTarget && dropPos === 'inside' ? 'ring-4 ring-sky-400/70' : ''}
                    `}
                    style={{
                      backgroundColor: bgColor,
                      borderColor: borderColor,
                      width: `${width}px`,
                      height: `${height}px`,
                      minHeight: '40px'
                    }}
                  >
                    {isDropTarget && dropPos === 'prev' && (
                      <div className="absolute -top-3 left-0 right-0 h-1 bg-sky-400 rounded-full shadow-lg shadow-sky-400/50" />
                    )}
                    {isDropTarget && dropPos === 'next' && (
                      <div className="absolute -bottom-3 left-0 right-0 h-1 bg-sky-400 rounded-full shadow-lg shadow-sky-400/50" />
                    )}

                    <textarea
                      value={node.data.text}
                      onChange={(e) => handleTextChange(node.data.id, e.target.value)}
                      onBlur={() => handleTextBlur()}
                      onKeyDown={(e) => handleInputKeyDown(e, node.data.id)}
                      onDoubleClick={(e) => handleInputDoubleClick(e as any)}
                      onSelect={(e) => handleInputSelect(e as any)}
                      onKeyUp={(e) => handleInputSelect(e as any)}
                      onClick={(e) => handleInputSelect(e as any)}
                      disabled={selectedIds.size > 1}
                      className={`
                          bg-transparent outline-none w-full text-center leading-normal placeholder-opacity-50 cursor-text resize-none overflow-y-auto scrollbar-hide
                          ${selectedIds.size > 1 ? 'pointer-events-none' : ''}
                      `}
                      style={{
                        color: textColor,
                        caretColor: textColor,
                        height: '100%',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        // Vertically align text if single line or short
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center'
                      }}
                      ref={(el) => {
                        if (el && isFocused && selectedIds.size === 1) {
                          if (document.activeElement !== el) {
                            el.focus({ preventScroll: true });
                          }
                        }
                      }}
                      placeholder={isRoot ? "主题" : "节点"}
                      spellCheck={false}
                    />
                  </div>
                </div>
              </foreignObject>
            );
          })}
        </g>
      </svg>

      {/* Selection Box */}
      {isSelecting && selectionRect && (
        <div
          className="absolute bg-sky-500/20 border border-sky-400 z-50 pointer-events-none"
          style={{
            left: Math.min(selectionRect.startX, selectionRect.currentX),
            top: Math.min(selectionRect.startY, selectionRect.currentY),
            width: Math.abs(selectionRect.currentX - selectionRect.startX),
            height: Math.abs(selectionRect.currentY - selectionRect.startY),
          }}
        />
      )}

      {/* Help Module (Global UI Overlay within MindMap) */}
      <div className="absolute bottom-6 left-6 z-50 flex flex-col items-start gap-4 pointer-events-auto">

        {/* Help Content Panel */}
        {isHelpOpen && (
          <div
            className="mb-2 p-6 border-2 border-dashed rounded-xl shadow-2xl animate-in slide-in-from-bottom-5 fade-in duration-300 max-w-sm backdrop-blur-md"
            style={{
              borderColor: getContrastingTextColor(theme.background) === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
              color: getContrastingTextColor(theme.background),
              backgroundColor: getContrastingTextColor(theme.background) === '#ffffff' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)' // Adaptive semi-transparent bg
            }}
          >
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2" style={{ opacity: 0.9 }}>
              <Keyboard size={16} /> 快捷键指南
            </h3>

            <div className="space-y-4 text-xs leading-relaxed">
              {/* Section 1: Create & Edit */}
              <div>
                <div className="mb-1 flex items-center gap-1" style={{ opacity: 0.7 }}><CornerDownLeft size={10} /> 创建与编辑</div>
                <div className="grid grid-cols-[80px_1fr] gap-y-1">
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Tab</span>
                  <span style={{ opacity: 0.8 }}>创建子级节点</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Shift + Tab</span>
                  <span style={{ opacity: 0.8 }}>升级节点（父级）</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Enter</span>
                  <span style={{ opacity: 0.8 }}>创建同级节点</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Shift + Enter</span>
                  <span style={{ opacity: 0.8 }}>节点内换行</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Alt + ↑/↓</span>
                  <span style={{ opacity: 0.8 }}>调整同级顺序</span>
                </div>
              </div>

              {/* Section 2: Navigation */}
              <div>
                <div className="mb-1 flex items-center gap-1" style={{ opacity: 0.7 }}><ArrowRightLeft size={10} /> 导航与切换</div>
                <div className="grid grid-cols-[80px_1fr] gap-y-1">
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>↑ / ↓</span>
                  <span style={{ opacity: 0.8 }}>切换同级节点</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>双击 ←</span>
                  <span style={{ opacity: 0.8 }}>光标在首位时跳转父级</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>双击 →</span>
                  <span style={{ opacity: 0.8 }}>光标在末位时跳转子级</span>
                </div>
              </div>

              {/* Section 3: View & Control */}
              <div>
                <div className="mb-1 flex items-center gap-1" style={{ opacity: 0.7 }}><Focus size={10} /> 视图控制</div>
                <div className="grid grid-cols-[80px_1fr] gap-y-1">
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Esc</span>
                  <span style={{ opacity: 0.8 }}>回归初始点</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Alt + Enter</span>
                  <span style={{ opacity: 0.8 }}>聚焦当前节点</span>
                  <span className="font-mono font-bold" style={{ opacity: 1 }}>Ctrl + Z</span>
                  <span style={{ opacity: 0.8 }}>撤销操作</span>
                </div>
              </div>

              {/* Section 4: Mouse */}
              <div>
                <div className="mb-1 flex items-center gap-1" style={{ opacity: 0.7 }}><MousePointer2 size={10} /> 鼠标操作</div>
                <div style={{ opacity: 0.8 }}>
                  拖拽节点移动位置 · 空白处拖拽框选
                </div>
                <div style={{ opacity: 0.8 }}>
                  右键点击Dock图标可删除、下载文件
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toggle Button */}
        <button
          onClick={toggleHelp}
          className={`
                flex items-center justify-center w-10 h-10 rounded-full border shadow-lg backdrop-blur-md transition-all duration-300 opacity-40 hover:opacity-100
                ${isHelpOpen ? 'rotate-90' : ''}
            `}
          style={{
            borderColor: getContrastingTextColor(theme.background) === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
            backgroundColor: isHelpOpen
              ? (getContrastingTextColor(theme.background) === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)')
              : 'transparent',
            color: getContrastingTextColor(theme.background)
          }}
          title={isHelpOpen ? "关闭帮助" : "快捷键指南"}
        >
          {isHelpOpen ? <X size={20} /> : <CircleHelp size={20} />}
        </button>
      </div>
    </div>
  );
});

export default React.memo(MindMap);
