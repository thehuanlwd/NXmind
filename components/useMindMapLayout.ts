import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import * as d3 from 'd3';
import { MindNode, ViewState, Theme } from '../types';
import { getSmartBorderColor } from '../utils/helpers';

const MIN_NODE_WIDTH = 80;
const DURATION = 300;

// Limits
const MAX_NODE_WIDTH = 500;
const MAX_NODE_HEIGHT = 600;
const NODE_HORIZONTAL_PADDING = 50;
const LINE_HEIGHT = 24;
const BASE_NODE_HEIGHT = 40;

const getWrappedLineCount = (text: string, maxTextWidth: number, ctx: CanvasRenderingContext2D | null) => {
  const paragraphs = text.split('\n');

  if (!ctx) {
    return Math.max(1, paragraphs.reduce((count, paragraph) => {
      const estimated = Math.max(1, Math.ceil(paragraph.length / 14));
      return count + estimated;
    }, 0));
  }

  let totalLines = 0;

  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      totalLines += 1;
      return;
    }

    let currentLine = '';

    for (const char of paragraph) {
      const nextLine = currentLine + char;
      if (ctx.measureText(nextLine).width <= maxTextWidth) {
        currentLine = nextLine;
        continue;
      }

      totalLines += 1;
      currentLine = char;
    }

    totalLines += currentLine ? 1 : 0;
  });

  return Math.max(1, totalLines);
};

// Layout Constants
const HORIZONTAL_GAP_MINDMAP = 60;

const ROW_HEIGHT_TREE = 60; // Vertical space per row in Tree mode
const INDENT_TREE = 40;     // Horizontal indent per depth in Tree mode

interface useMindMapLayoutProps {
  internalData: MindNode;
  svgRef: React.RefObject<SVGSVGElement>;
  wrapperRef: React.RefObject<HTMLDivElement>;
  viewState: ViewState;
  theme: Theme;
  isSelecting: boolean;
  onViewStateChange: (newState: ViewState) => void;
}

export const useMindMapLayout = ({
  internalData,
  svgRef,
  wrapperRef,
  viewState,
  theme,
  isSelecting,
  onViewStateChange,
}: useMindMapLayoutProps) => {
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const viewStateRef = useRef(viewState);
  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  const layoutType = viewState.layout || 'mindmap';

  // --- D3 Layout Calculation ---
  const calculateLayout = useCallback(() => {
    const root = d3.hierarchy(internalData);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.font = '16px system-ui, -apple-system, sans-serif';

    // 1. Measure text width for all nodes (Multiline support)
    root.descendants().forEach((d: any) => {
      const text = d.data.text || (d.data.isRoot ? "中心主题" : " ");
      const lines = text.split('\n');
      const maxTextWidth = MAX_NODE_WIDTH - NODE_HORIZONTAL_PADDING;
      
      let maxWidth = MIN_NODE_WIDTH;
      if (ctx) {
          lines.forEach((line: string) => {
              const metrics = ctx.measureText(line);
              if (metrics.width > maxWidth) maxWidth = metrics.width;
          });
      }

      const calculatedWidth = Math.max(MIN_NODE_WIDTH, maxWidth + NODE_HORIZONTAL_PADDING);
      d.width = Math.min(calculatedWidth, MAX_NODE_WIDTH);

      const wrappedLineCount = getWrappedLineCount(text, maxTextWidth, ctx);
      const estimatedHeight = Math.max(BASE_NODE_HEIGHT, BASE_NODE_HEIGHT + (wrappedLineCount - 1) * LINE_HEIGHT);
      d.actualHeight = Math.min(estimatedHeight, MAX_NODE_HEIGHT);
    });

    if (layoutType === 'tree') {
        // --- Custom List/Indented Tree Layout ---
        let currentY = 0;
        root.eachBefore((d: any) => {
            const nodeHeight = d.actualHeight || 40;
            
            // 修正：计算节点中心位置 (d.x 在 D3 tree 中对应垂直方向)
            // d.x 应该是当前游标位置(Top) + 半个高度，这样渲染时的 (center - height/2) 才会对齐 Top
            d.x = currentY + (nodeHeight / 2); 
            d.y = d.depth * INDENT_TREE;
            
            // 累加高度和间距，更新游标到下一个节点的 Top 位置
            currentY += nodeHeight + 10; // 10px vertical gap
        });

    } else {
        // --- Standard Mind Map (D3 Tree) Layout ---
        const treeLayout = d3.tree<MindNode>()
          .nodeSize([10, 0]) // We'll adjust separation manually
          .separation((a, b) => {
              // Calculate vertical space based on max heights of subtrees? 
              // D3 tree is fixed nodeSize usually.
              // We'll use a larger base separation and let D3 handle it, 
              // or use variable node size logic which is complex in vanilla D3 tree.
              // Simplification: Use a safe multiplier based on height
              const ha = (a as any).actualHeight || 40;
              const hb = (b as any).actualHeight || 40;
              const maxH = Math.max(ha, hb);
              // Base size was 60. Ratio = maxH / 60.
              const sep = (maxH + 20) / 60; // normalize to standard nodeSize unit
              
              return (a.parent === b.parent ? 1.1 : 1.25) * Math.max(1, sep);
          })
          .nodeSize([60, 0]); // Base vertical slot size

        treeLayout(root);

        // Adjust horizontal spacing based on max width per depth
        const maxWidhtsPerDepth: { [key: number]: number } = {};
        root.descendants().forEach((d: any) => {
          const currentMax = maxWidhtsPerDepth[d.depth] || 0;
          if (d.width > currentMax) maxWidhtsPerDepth[d.depth] = d.width;
        });

        const depthOffsets: { [key: number]: number } = { 0: 0 };
        let currentOffset = 0;
        const maxDepth = Math.max(...root.descendants().map(d => d.depth));

        for (let i = 0; i < maxDepth; i++) {
          currentOffset += (maxWidhtsPerDepth[i] || MIN_NODE_WIDTH) + HORIZONTAL_GAP_MINDMAP;
          depthOffsets[i + 1] = currentOffset;
        }

        root.descendants().forEach((d: any) => {
          d.y = depthOffsets[d.depth] || 0;
        });
    }

    return root;
  }, [internalData, layoutType]);

  const layoutNodes = calculateLayout().descendants() as any[];

  // --- Center View Logic ---
  const centerView = useCallback((targetId?: string | null, clearFocus = true, preserveScale = false, targetScreenX?: number, targetScreenY?: number) => {
    if (!wrapperRef.current || !svgRef.current || !zoomBehaviorRef.current) return;

    const root = calculateLayout();
    const idToFind = targetId || internalData.id;
    const targetNode = root.descendants().find((d: any) => d.data.id === idToFind) as any;

    if (!targetNode) return;

    const width = wrapperRef.current.clientWidth;
    const height = wrapperRef.current.clientHeight;

    const currentTransform = d3.zoomTransform(svgRef.current);
    const targetScale = preserveScale ? currentTransform.k : 1;

    // Map logic coordinates to screen rendering coordinates
    const nodeScreenX = targetNode.y - 10;
    const nodeScreenY = targetNode.x - (targetNode.actualHeight || 40) / 2; // Center based on height
    const nodeW = targetNode.width + 20;
    const nodeH = targetNode.actualHeight || 80;

    const nodeCenterX = nodeScreenX + nodeW / 2;
    const nodeCenterY = nodeScreenY + nodeH / 2;

    // Default: Center in viewport
    let targetX = (width / 2) - (nodeCenterX * targetScale);
    let targetY = (height / 2) - (nodeCenterY * targetScale);

    if (targetScreenX !== undefined && targetScreenY !== undefined) {
        targetX = targetScreenX - (nodeScreenX * targetScale);
        targetY = targetScreenY - (nodeScreenY * targetScale);
    }

    const transform = d3.zoomIdentity.translate(targetX, targetY).scale(targetScale);

    d3.select(svgRef.current)
      .transition().duration(500)
      .call(zoomBehaviorRef.current.transform, transform);

    onViewStateChange({
      x: targetX,
      y: targetY,
      k: targetScale,
      focusedNodeId: clearFocus ? null : (targetId || viewState.focusedNodeId),
      needsCentering: false,
      layout: viewState.layout
    });
  }, [calculateLayout, internalData.id, onViewStateChange, viewState.focusedNodeId, viewState.layout]);

  // --- Auto Pan for New Nodes ---
  const autoPan = useCallback((editingId: string | null) => {
    if (!editingId || !svgRef.current || !zoomBehaviorRef.current || !wrapperRef.current) return;

    const root = calculateLayout();
    const node = root.descendants().find((d: any) => d.data.id === editingId) as any;
    if (!node) return;

    const transform = d3.zoomTransform(svgRef.current);

    const nodeHeight = node.actualHeight || 80;
    const nodeX = transform.applyX(node.y - 10);
    const nodeY = transform.applyY(node.x - nodeHeight/2);
    const nodeW = (node.width + 20) * transform.k;
    const nodeH = nodeHeight * transform.k;

    const viewportW = wrapperRef.current.clientWidth;
    const viewportH = wrapperRef.current.clientHeight;
    const padding = 60;

    let dx = 0, dy = 0;

    if (nodeX + nodeW > viewportW - padding) dx = viewportW - padding - (nodeX + nodeW);
    if (nodeX < padding) dx = padding - nodeX;
    if (nodeY + nodeH > viewportH - padding) dy = viewportH - padding - (nodeY + nodeH);
    if (nodeY < padding) dy = padding - nodeY;

    if (dx !== 0 || dy !== 0) {
      const newTransform = transform.translate(dx / transform.k, dy / transform.k);
      d3.select(svgRef.current)
        .transition().duration(300)
        .call(zoomBehaviorRef.current.transform, newTransform);
    }
  }, [calculateLayout]);


  // --- Zoom & Pan ---
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = svg.select<SVGGElement>('.mindmap-group');

    const zoomed = (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      g.attr('transform', event.transform.toString());
      if (!isSelecting && event.sourceEvent) {
        onViewStateChange({
          ...viewStateRef.current,
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        });
      }
    };

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .filter((event) => {
        if (event.type === 'wheel') return true;
        if (event.button === 2 || event.button === 1) return true;
        if (event.type === 'touchstart') return true;
        return false;
      })
      .on('zoom', zoomed);

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    const transform = d3.zoomIdentity.translate(viewState.x, viewState.y).scale(viewState.k);
    svg.call(zoom.transform, transform);

    svg.on("dblclick.zoom", null);

  }, [svgRef, internalData.id, isSelecting, onViewStateChange]);


  // --- D3 Render Links ---
  const renderTreeLinks = useCallback(() => {
    if (!svgRef.current) return;
    const root = calculateLayout();
    const g = d3.select(svgRef.current).select('.mindmap-group');
    const linkGroup = g.select('.links');

    const getNodeBaseColor = (depth: number) => theme.nodeColors[depth % theme.nodeColors.length];
    const getNodeBorderColor = (depth: number) => getSmartBorderColor(getNodeBaseColor(depth));

    const links = linkGroup.selectAll<SVGPathElement, d3.HierarchyPointLink<MindNode>>('path')
      .data(root.links(), (d) => d.target.data.id);

    // 1. Curved Bezier for standard MindMap
    const bezierPath = (d: any) => {
        const sourceNode = d.source;
        const targetNode = d.target;
        // Logic Coords: .y is Horizontal, .x is Vertical
        const sx = sourceNode.y + sourceNode.width;
        const sy = sourceNode.x;
        const tx = targetNode.y;
        const ty = targetNode.x;
        return `M${sx},${sy}C${(sx + tx) / 2},${sy} ${(sx + tx) / 2},${ty} ${tx},${ty}`;
    };

    // 2. L-Shaped Orthogonal for List/Tree
    const listPath = (d: any) => {
        const s = d.source;
        const t = d.target;
        
        // Adjust sourceY to start from bottom of source node text area approx
        // s.x is vertical center of node. s.actualHeight is height.
        // Let's start from slight bottom left of parent to connect to child left
        const sHeight = s.actualHeight || 40;
        
        const startX = s.y + 15; // Indent vertical line slightly from parent left
        const startY = s.x + (sHeight / 2) + 5; // Start below the parent text

        // Target: Left side of child text, Vertical center
        const endX = t.y; 
        const endY = t.x;

        // Path: Down from parent, then Right to child
        // M startX startY -> V endY -> H endX
        return `M${startX},${startY} V${endY} H${endX}`;
    };

    links.enter()
      .append('path')
      .attr('d', d => {
         const o = { x: d.source.x, y: d.source.y }; 
         return `M${o.y},${o.x}L${o.y},${o.x}`; 
      })
      .attr('fill', 'none')
      .attr('stroke-width', 2)
      .merge(links as any)
      .transition().duration(DURATION)
      .attr('stroke', (d) => getNodeBorderColor(d.source.depth))
      .attr('opacity', 1)
      .attr('d', layoutType === 'tree' ? listPath : bezierPath);

    links.exit().transition().duration(DURATION).attr('opacity', 0).remove();
  }, [calculateLayout, theme, svgRef, layoutType]);

  useLayoutEffect(() => {
    renderTreeLinks();
  }, [renderTreeLinks]);

  return { layoutNodes, centerView, autoPan, zoomBehaviorRef };
};
