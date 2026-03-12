import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as d3 from 'd3';
import { MindNode, ViewState } from '../types';
import { useHistory } from '../utils/useHistory';
import { generateId, findNodeById, findParentNode, moveNode, moveNodes, isDescendant, copyNode } from '../utils/helpers';

// Define LayoutNode to fix type errors
export interface LayoutNode {
    data: MindNode;
    x: number;
    y: number;
    width: number;
    actualHeight?: number;
    depth: number;
}

interface DropTargetState {
    nodeId: string;
    position: 'inside' | 'prev' | 'next';
}

interface SelectionRect {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

// Helper: 根据鼠标在节点中的位置计算逻辑位置
const getDropPosition = (e: React.DragEvent, isRoot: boolean): 'inside' | 'prev' | 'next' => {
    if (isRoot) return 'inside';
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const height = rect.height;

    if (offsetY < height * 0.25) return 'prev';
    if (offsetY > height * 0.75) return 'next';
    return 'inside';
};


interface useMindMapInteractionProps {
    data: MindNode;
    viewState: ViewState;
    isActive: boolean;
    onChange: (newData: MindNode) => void;
    onViewStateChange: (newState: ViewState) => void;
    centerView: (targetId?: string | null, clearFocus?: boolean, preserveScale?: boolean) => void;
    autoPan: (editingId: string | null) => void;
    wrapperRef: React.RefObject<HTMLDivElement>;
    svgRef: React.RefObject<SVGSVGElement>;
    layoutCache: React.MutableRefObject<any[]>; // Accepts any[] from Ref, but we cast to LayoutNode[] internally
}

export const useMindMapInteraction = ({
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
}: useMindMapInteractionProps) => {

    const {
        state: internalData,
        set: setInternalDataWithHistory,
        setSilent: setInternalDataSilent,
        pushStateManual,
        undo: originalUndo,
        redo: originalRedo
    } = useHistory<MindNode>(data);

    // Track the last "Committed" history state (to restore proper past when creating new history entry)
    const lastCommittedData = useRef<MindNode>(data);

    // Wrap undo/redo to sync the committed state ref
    const undo = useCallback(() => {
        // Critical Fix: Clear any pending debounced save to prevent "ghost" overwrites after undo
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
            isTransientRef.current = false;
        }
        originalUndo();
    }, [originalUndo]);

    const redo = useCallback(() => {
        // Critical Fix: Clear any pending debounced save
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
            isTransientRef.current = false;
        }
        originalRedo();
    }, [originalRedo]);

    const isTransientRef = useRef(false);

    useEffect(() => {
        if (!isTransientRef.current) {
            lastCommittedData.current = internalData;
        }
    }, [internalData]);

    const [editingId, setEditingId] = useState<string | null>(viewState.focusedNodeId);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Selection Box State
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);

    // Drag & Drop State
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);

    // Key press tracking for double-tap detection
    const lastKeyRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });

    useEffect(() => {
        if (data.id !== internalData.id) {
            setInternalDataSilent(data);
        }
    }, [data.id, internalData.id, setInternalDataSilent]);

    // Sync focusedNodeId to editingId but also handle selection
    useEffect(() => {
        setEditingId(viewState.focusedNodeId);
        if (viewState.focusedNodeId) {
            setSelectedIds(new Set([viewState.focusedNodeId]));
        }
    }, [viewState.focusedNodeId]);

    useEffect(() => {
        autoPan(editingId);
    }, [editingId, autoPan]);

    // 当撤销/重做导致 internalData 变化时，通知父组件保存
    useEffect(() => {
        onChange(internalData);
    }, [internalData, onChange]);


    // --- Data Mutation Handlers ---

    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cancel any pending text save (avoids "Ghost Updates" reviving deleted nodes)
    const cancelPendingTextSave = useCallback(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        isTransientRef.current = false;
    }, []);

    const handleTextChange = (id: string, newText: string) => {
        // 5. 限制单节点文本字符最大5000字
        if (newText.length > 5000) {
            alert("字符太多要爆掉啦");
            return;
        }

        isTransientRef.current = true; // Mark as transient

        const updateText = (node: MindNode): MindNode => {
            if (node.id === id) return { ...node, text: newText };
            return { ...node, children: node.children.map(updateText) };
        };
        const newData = updateText(internalData);
        setInternalDataSilent(newData);

        // Debounce history save (granular text undo)
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            // Commit!
            if (lastCommittedData.current !== newData) {
                pushStateManual(newData, lastCommittedData.current, 'Update Node Text');
                lastCommittedData.current = newData;
                isTransientRef.current = false; // Commit complete
            }
            saveTimeoutRef.current = null;
        }, 800);
    };

    const handleTextBlur = () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        // Force commit on blur if changed
        if (internalData !== lastCommittedData.current) {
            pushStateManual(internalData, lastCommittedData.current, 'Update Node Text (Blur)');
            lastCommittedData.current = internalData;
        }
        isTransientRef.current = false;
    };

    const addChild = (parentId: string) => {
        cancelPendingTextSave(); // Ensure no pending text updates interfere
        const newId = generateId();
        const newNode: MindNode = { id: newId, text: '', children: [] };
        const addToNode = (node: MindNode): MindNode => {
            if (node.id === parentId) return { ...node, children: [...node.children, newNode] };
            return { ...node, children: node.children.map(addToNode) };
        };
        const newData = addToNode(internalData);
        setInternalDataWithHistory(newData, 'Add Child Node');
        setEditingId(newId);
        setSelectedIds(new Set([newId]));
        onViewStateChange({ ...viewState, focusedNodeId: newId });
    };

    const addSibling = (currentId: string) => {
        if (currentId === internalData.id) return;
        cancelPendingTextSave(); // Ensure no pending text updates interfere
        const newId = generateId();
        const newNode: MindNode = { id: newId, text: '', children: [] };
        const addSib = (node: MindNode): MindNode => {
            if (node.children.some(c => c.id === currentId)) {
                const idx = node.children.findIndex(c => c.id === currentId);
                const newChildren = [...node.children];
                newChildren.splice(idx + 1, 0, newNode);
                return { ...node, children: newChildren };
            }
            return { ...node, children: node.children.map(addSib) };
        };
        const newData = addSib(internalData);
        setInternalDataWithHistory(newData, 'Add Sibling Node');
        setEditingId(newId);
        setSelectedIds(new Set([newId]));
        onViewStateChange({ ...viewState, focusedNodeId: newId });
    };

    // 1. 升级节点 (Shift + Tab)
    const promoteNode = (id: string) => {
        if (id === internalData.id) return;
        const parent = findParentNode(internalData, id);
        if (!parent || parent.id === internalData.id) return; // 已经是根节点的子节点，无法再升级

        cancelPendingTextSave();
        // 逻辑：移动到 Parent 的后面 (next)
        const newData = moveNode(internalData, id, parent.id, 'next');
        setInternalDataWithHistory(newData, 'Promote Node');
        // Focus remains on id
    };

    // 2. 节点排序 (Alt + Up/Down)
    const reorderNode = (id: string, direction: 'up' | 'down') => {
        if (id === internalData.id) return;
        const parent = findParentNode(internalData, id);
        if (!parent) return;

        const index = parent.children.findIndex(c => c.id === id);
        if (index === -1) return;

        let targetId: string | null = null;
        let pos: 'prev' | 'next' = 'next';

        if (direction === 'up') {
            if (index > 0) {
                targetId = parent.children[index - 1].id;
                pos = 'prev'; // 放在上一个的前面
            }
        } else {
            if (index < parent.children.length - 1) {
                targetId = parent.children[index + 1].id;
                pos = 'next'; // 放在下一个的后面
            }
        }

        if (targetId) {
            cancelPendingTextSave();
            const newData = moveNode(internalData, id, targetId, pos);
            setInternalDataWithHistory(newData, 'Reorder Node');
        }
    };


    const deleteNode = (id: string, nextFocusId?: string) => {
        if (id === internalData.id) return;

        cancelPendingTextSave(); // CRITICAL: Stop any pending text saves for the node being deleted

        let parentId: string | null = null;
        const remove = (node: MindNode): MindNode => {
            if (node.children.some(c => c.id === id)) {
                parentId = node.id;
                return { ...node, children: node.children.filter(c => c.id !== id) };
            }
            return { ...node, children: node.children.map(remove) };
        };
        const newData = remove(internalData);
        setInternalDataWithHistory(newData, 'Delete Node');

        const targetId = nextFocusId || parentId;
        if (targetId) {
            setEditingId(targetId);
            setSelectedIds(new Set([targetId]));
            onViewStateChange({ ...viewState, focusedNodeId: targetId });
        }
    };

    const batchDelete = useCallback(() => {
        cancelPendingTextSave(); // CRITICAL: Stop pending saves

        const idsToDelete: string[] = Array.from(selectedIds);
        if (idsToDelete.includes(internalData.id)) {
            idsToDelete.splice(idsToDelete.indexOf(internalData.id), 1);
        }
        if (idsToDelete.length === 0) return;

        let fallbackId: string | null = null;
        if (idsToDelete.length > 0) {
            const firstId = idsToDelete[0];
            const parent = findParentNode(internalData, firstId);
            if (parent) fallbackId = parent.id;
        }

        const removeRecursive = (node: MindNode): MindNode => {
            return {
                ...node,
                children: node.children
                    .filter(c => !idsToDelete.includes(c.id))
                    .map(removeRecursive)
            };
        };

        const newData = removeRecursive(internalData);
        setInternalDataWithHistory(newData, 'Batch Delete Nodes');
        setSelectedIds(new Set());

        if (fallbackId && findNodeById(newData, fallbackId)) {
            setEditingId(fallbackId);
            onViewStateChange({ ...viewState, focusedNodeId: fallbackId });
        } else {
            setEditingId(null);
        }
    }, [selectedIds, internalData, setInternalDataWithHistory, onViewStateChange, viewState, cancelPendingTextSave]);


    // --- Shortcuts & Global Handlers ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isActive) return;
            // Undo/Redo
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
            } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y')) {
                e.preventDefault();
                redo();
            }
            // Batch Delete
            else if (e.key === 'Delete' || e.key === 'Backspace') {
                const activeTag = document.activeElement?.tagName.toLowerCase();
                if (activeTag === 'input' || activeTag === 'textarea') return;

                if (selectedIds.size > 0) {
                    e.preventDefault();
                    batchDelete();
                }
            } else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                // Global Copy (Multi-select)
                if (selectedIds.size >= 1) {
                    e.preventDefault();
                    // ... serialization logic ...
                    const ids = Array.from(selectedIds);
                    const nodesMap = new Map<string, MindNode>();
                    ids.forEach(id => {
                        const node = findNodeById(internalData, id);
                        if (node) nodesMap.set(id, node);
                    });

                    const topLevelNodes: MindNode[] = [];
                    nodesMap.forEach((node, id) => {
                        let isChildOfSelection = false;
                        let curr = findParentNode(internalData, id);
                        while (curr) {
                            if (selectedIds.has(curr.id)) {
                                isChildOfSelection = true;
                                break;
                            }
                            curr = findParentNode(internalData, curr.id);
                            if (curr?.id === internalData.id) break;
                        }
                        if (!isChildOfSelection) topLevelNodes.push(node);
                    });

                    const serializeNode = (node: MindNode, depth: number = 0): string => {
                        const indent = '  '.repeat(depth);
                        const prefix = '- ';
                        let md = `${indent}${prefix}${node.text}`;

                        if (node.children && node.children.length > 0) {
                            const childMd = node.children
                                .filter(child => selectedIds.has(child.id))
                                .map(child => serializeNode(child, depth + 1))
                                .join('\n');
                            if (childMd) {
                                md += '\n' + childMd;
                            }
                        }
                        return md;
                    };

                    const md = topLevelNodes.map(n => serializeNode(n)).join('\n');
                    navigator.clipboard.writeText(md);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, undo, redo, selectedIds, batchDelete, internalData]);

    useEffect(() => {
        const handleGlobalKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isActive) {
                if (isSelecting) {
                    setIsSelecting(false);
                    setSelectionRect(null);
                    return;
                }
                setSelectedIds(new Set());
                setEditingId(null);
                centerView(null, true);
            }
        };
        window.addEventListener('keydown', handleGlobalKey);
        return () => window.removeEventListener('keydown', handleGlobalKey);
    }, [isActive, isSelecting, centerView]);


    // --- Node Input Handlers ---
    const handleInputKeyDown = (e: React.KeyboardEvent, nodeId: string) => {
        e.stopPropagation();

        const now = Date.now();
        const DOUBLE_TAP_DELAY = 300;

        const isDoubleTap = (key: string) => {
            const isDt = lastKeyRef.current &&
                lastKeyRef.current.key === key &&
                (now - lastKeyRef.current.time) < DOUBLE_TAP_DELAY;
            lastKeyRef.current = { key, time: now };
            return isDt;
        };

        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
            const input = e.currentTarget as HTMLTextAreaElement;
            const hasSelection = input.selectionStart !== input.selectionEnd;

            if (selectedIds.size <= 1 && !hasSelection) {
                e.preventDefault();
                const node = findNodeById(internalData, nodeId);
                if (node) {
                    navigator.clipboard.writeText(node.text);
                }
            }
            return;
        }

        if (e.altKey && e.key === 'Enter') {
            e.preventDefault();
            centerView(nodeId, false, true);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.repeat) return;
            // 1. Shift + Tab: 升级节点
            if (e.shiftKey) {
                promoteNode(nodeId);
            } else {
                addChild(nodeId);
            }
        } else if (e.key === 'Enter') {
            // 3. Shift + Enter: 节点内换行 (不创建兄弟节点)
            if (e.shiftKey) {
                e.stopPropagation(); // 允许默认行为 (textarea 换行)
                return;
            }
            e.preventDefault();
            addSibling(nodeId);
        } else if (e.key === 'Escape') {
            (e.target as HTMLElement).blur();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (e.key === 'Backspace') {
                const input = e.target as HTMLTextAreaElement;
                if (input.value === '') {
                    if (isDoubleTap('BackspaceEmpty')) {
                        e.preventDefault();
                        const parent = findParentNode(internalData, nodeId);
                        let nextFocusId: string | undefined;
                        if (parent) {
                            const idx = parent.children.findIndex(c => c.id === nodeId);
                            if (idx > 0) nextFocusId = parent.children[idx - 1].id;
                            else nextFocusId = parent.id;
                        }
                        deleteNode(nodeId, nextFocusId);
                        return;
                    }
                }
            }

            if (e.key === 'Delete') {
                e.preventDefault();
                const parent = findParentNode(internalData, nodeId);
                let nextFocusId: string | undefined;
                if (parent) {
                    const idx = parent.children.findIndex(c => c.id === nodeId);
                    if (idx > 0) {
                        nextFocusId = parent.children[idx - 1].id;
                    } else {
                        nextFocusId = parent.id;
                    }
                }
                deleteNode(nodeId, nextFocusId);
            }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // 2. Alt + Up/Down: 排序
            if (e.altKey) {
                e.preventDefault();
                reorderNode(nodeId, e.key === 'ArrowUp' ? 'up' : 'down');
                return;
            }

            // Normal Navigation
            e.preventDefault();
            // Cast strictly to LayoutNode[] to fix type errors
            const nodes = layoutCache.current as LayoutNode[];
            const currentNodeLayout = nodes.find(d => d.data.id === nodeId);
            if (!currentNodeLayout) return;

            const isUp = e.key === 'ArrowUp';

            const candidates = nodes.filter(d => {
                if (d.data.id === nodeId) return false;
                return isUp ? d.x < currentNodeLayout.x : d.x > currentNodeLayout.x;
            });

            if (candidates.length > 0) {
                let closestNode: LayoutNode | null = null;
                let minDistanceSq = Infinity;

                candidates.forEach(d => {
                    const dx = d.y - currentNodeLayout.y;
                    const dy = d.x - currentNodeLayout.x;
                    const distanceSq = dx * dx + dy * dy;

                    if (distanceSq < minDistanceSq) {
                        minDistanceSq = distanceSq;
                        closestNode = d;
                    }
                });

                if (closestNode) {
                    const nextId = (closestNode as LayoutNode).data.id;
                    setEditingId(nextId);
                    onViewStateChange({ ...viewState, focusedNodeId: nextId });
                }
            }
        } else if (e.key === 'ArrowLeft') {
            const input = e.target as HTMLTextAreaElement;
            if (input.selectionStart === 0 && input.selectionEnd === 0) {
                if (isDoubleTap('ArrowLeft')) {
                    e.preventDefault();
                    const parent = findParentNode(internalData, nodeId);
                    if (parent) {
                        setEditingId(parent.id);
                        onViewStateChange({ ...viewState, focusedNodeId: parent.id });
                    }
                }
            } else {
                lastKeyRef.current = { key: '', time: 0 };
            }
        } else if (e.key === 'ArrowRight') {
            const input = e.target as HTMLTextAreaElement;
            if (input.selectionStart === input.value.length) {
                if (isDoubleTap('ArrowRight')) {
                    e.preventDefault();
                    const node = findNodeById(internalData, nodeId);
                    if (node && node.children.length > 0) {
                        const child = node.children[0];
                        setEditingId(child.id);
                        onViewStateChange({ ...viewState, focusedNodeId: child.id });
                    }
                }
            } else {
                lastKeyRef.current = { key: '', time: 0 };
            }
        }
    };

    const handleInputDoubleClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
        e.currentTarget.select();
    };

    const handleInputSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const input = e.currentTarget;
        if (input.selectionStart === 0 && input.selectionEnd === 0) {
            input.style.caretColor = '#f472b6'; // Pink
        } else if (input.selectionStart === input.value.length) {
            input.style.caretColor = '#22d3ee'; // Cyan
        } else {
            input.style.caretColor = '';
        }
    };

    // --- Click & Focus Logic ---
    const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();

        if (e.metaKey || e.ctrlKey) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(nodeId)) next.delete(nodeId);
                else next.add(nodeId);
                return next;
            });
            setEditingId(null);
        } else {
            setEditingId(nodeId);
            setSelectedIds(new Set([nodeId]));
            onViewStateChange({ ...viewState, focusedNodeId: nodeId });
        }
    };

    // DEBUG: Global Drag Listener to check if WebView is alive
    useEffect(() => {
        const globalDragOver = (e: DragEvent) => {
            console.log('[Global] DragOver:', e.clientX, e.clientY, e.target);
            // e.preventDefault(); // Uncommenting this 'force allows' drops everywhere, potentially useful for testing
        };
        const globalDrop = (e: DragEvent) => {
            console.log('[Global] Drop:', e.clientX, e.clientY);
        };

        document.addEventListener('dragover', globalDragOver);
        document.addEventListener('drop', globalDrop);
        return () => {
            document.removeEventListener('dragover', globalDragOver);
            document.removeEventListener('drop', globalDrop);
        };
    }, []);

    // --- Drag & Drop Handlers ---
    const handleDragStart = (e: React.DragEvent, nodeId: string) => {
        // DEBUG LOG
        console.log('[MindMap] Drag Start:', nodeId);

        e.stopPropagation();
        setDraggedNodeId(nodeId);

        if (!selectedIds.has(nodeId)) {
            setSelectedIds(new Set([nodeId]));
            setEditingId(null);
        }

        e.dataTransfer.effectAllowed = 'move';
        // CRITICAL FIX: Tauri/WebView2 requires data to be set to recognize the drag
        e.dataTransfer.setData('text/plain', nodeId);

        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragEnd = (e: React.DragEvent) => {
        // DEBUG LOG
        console.log('[MindMap] Drag End');
        e.preventDefault();
        e.stopPropagation();
        setDraggedNodeId(null);
        setDropTarget(null);
    };

    const commitDrop = useCallback((target: DropTargetState, isCopy: boolean) => {
        const { nodeId: targetId, position: pos } = target;

        if (selectedIds.size > 1) {
            if (isCopy) {
                const ids = Array.from(selectedIds);
                let currentData = internalData;
                ids.forEach(id => {
                    if (!isDescendant(currentData, targetId, id)) {
                        currentData = copyNode(currentData, id, targetId, pos === 'inside' ? 'inside' : 'next');
                    }
                });
                setInternalDataWithHistory(currentData, 'Paste/Copy Nodes');
                return;
            }

            const newData = moveNodes(internalData, Array.from(selectedIds), targetId);
            setInternalDataWithHistory(newData, 'Move Nodes');
            return;
        }

        if (!draggedNodeId || draggedNodeId === targetId) return;
        if (isDescendant(internalData, targetId, draggedNodeId)) {
            console.warn('[MindMap] Drop invalid: Descendant check failed');
            return;
        }

        if (isCopy) {
            const newData = copyNode(internalData, draggedNodeId, targetId, pos);
            setInternalDataWithHistory(newData, 'Copy Node');
            return;
        }

        console.log('[MindMap] Execute Move Node:', { draggedNodeId, targetId, pos });
        const newData = moveNode(internalData, draggedNodeId, targetId, pos);
        setInternalDataWithHistory(newData, 'Move Node');
    }, [draggedNodeId, internalData, selectedIds, setInternalDataWithHistory]);

    const handleDragOver = (e: React.DragEvent, targetId: string, isRoot: boolean) => {
        e.preventDefault();
        e.stopPropagation();

        if (!draggedNodeId) return;
        if (draggedNodeId === targetId) return;
        if (isDescendant(internalData, targetId, draggedNodeId)) return;

        const isMultiDrag = selectedIds.size > 1;
        const pos = isMultiDrag ? 'inside' : getDropPosition(e, isRoot);

        // DEBUG LOG (Throttled manually by eyes or assume browser console groups it)
        // console.log('[MindMap] Drag Over:', { targetId, pos, clientY: e.clientY });

        setDropTarget(prev => {
            // Optimization: Only update if changed to avoid render thrashing
            if (prev?.nodeId === targetId && prev?.position === pos) return prev;
            console.log('[MindMap] Drag Over State Update:', { targetId, pos });
            return { nodeId: targetId, position: pos };
        });
    };

    const handleDrop = (e: React.DragEvent, targetId: string, isRoot: boolean) => {
        console.log('[MindMap] Drop Triggered:', { targetId, draggedNodeId });
        e.preventDefault();
        e.stopPropagation();

        const isMultiDrag = selectedIds.size > 1;
        const pos = isMultiDrag ? 'inside' : getDropPosition(e, isRoot);
        const isCopy = e.ctrlKey || e.metaKey;
        commitDrop({ nodeId: targetId, position: pos }, isCopy);
        setDraggedNodeId(null);
        setDropTarget(null);
    };

    const handleCanvasDragOver = (e: React.DragEvent) => {
        if (!draggedNodeId) return;
        e.preventDefault();
    };

    const handleCanvasDrop = (e: React.DragEvent) => {
        if (!draggedNodeId) return;

        console.log('[MindMap] Canvas Drop Triggered:', dropTarget);
        e.preventDefault();
        e.stopPropagation();

        if (dropTarget) {
            const isCopy = e.ctrlKey || e.metaKey;
            commitDrop(dropTarget, isCopy);
        }

        setDraggedNodeId(null);
        setDropTarget(null);
    };

    // --- Box Selection Handlers ---
    const getLocalPoint = (e: React.MouseEvent) => {
        if (!wrapperRef.current) return { x: 0, y: 0 };
        const rect = wrapperRef.current.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;

        const { x, y } = getLocalPoint(e);

        setIsSelecting(true);
        setSelectionRect({
            startX: x,
            startY: y,
            currentX: x,
            currentY: y
        });
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            setSelectedIds(new Set());
            setEditingId(null);
        }
    };

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isSelecting || !selectionRect) return;

        const { x: currentX, y: currentY } = getLocalPoint(e);

        setSelectionRect(prev => prev ? ({ ...prev, currentX, currentY }) : null);

        const x = Math.min(selectionRect.startX, currentX);
        const y = Math.min(selectionRect.startY, currentY);
        const w = Math.abs(currentX - selectionRect.startX);
        const h = Math.abs(currentY - selectionRect.startY);

        const transform = d3.zoomTransform(svgRef.current!);
        const newSelected = new Set<string>();

        // Cast strictly
        const nodes = layoutCache.current as LayoutNode[];

        nodes.forEach((d) => {
            const nodeX = d.y - 10;
            const nodeY = d.x - 40;
            const nodeW = d.width + 20;
            const nodeH = d.actualHeight || 80;

            const screenX = transform.applyX(nodeX);
            const screenY = transform.applyY(nodeY);
            const screenW = nodeW * transform.k;
            const screenH = nodeH * transform.k;

            if (
                x < screenX + screenW &&
                x + w > screenX &&
                y < screenY + screenH &&
                y + h > screenY
            ) {
                newSelected.add(d.data.id);
            }
        });

        setSelectedIds(newSelected);

    }, [isSelecting, selectionRect, svgRef, layoutCache]);

    const handleMouseUp = () => {
        setIsSelecting(false);
        setSelectionRect(null);
    };


    return {
        internalData,
        editingId,
        selectedIds,
        isSelecting,
        selectionRect,
        draggedNodeId,
        dropTarget,

        // Handlers
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
    };
};
