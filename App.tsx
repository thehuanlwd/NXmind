import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Note, MindNode, ViewState, ThemeId } from './types';
import { createNewNote, noteToMarkdown, THEMES, getContrastingTextColor } from './utils/helpers';
import MindMap, { MindMapHandle } from './components/MindMap';
import Dock from './components/Dock';
import { TitleBar } from './components/TitleBar';
import { Settings } from './components/Settings';
import { listen } from '@tauri-apps/api/event';
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { Plus, Download, Copy, Trash2, Menu, GitGraph } from 'lucide-react';

const STORAGE_KEY = 'mindflow_notes_v1';
const ACTIVE_ID_KEY = 'mindflow_active_id';
const DEFAULT_THEME_KEY = 'mindflow_default_theme';
const DOCK_POS_KEY = 'mindflow_dock_pos';
const WINDOW_EDGE_PADDING = 48;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const rectsIntersect = (
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number
) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

const App: React.FC = () => {
    const [notes, setNotes] = useState<Note[]>([]);
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [defaultTheme, setDefaultTheme] = useState<ThemeId>('night');
    const [isDragOverNew, setIsDragOverNew] = useState(false);
    const [dockPosition, setDockPosition] = useState<'right' | 'bottom'>('right');
    const [showIntroUI, setShowIntroUI] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
    const [dockAutoHide, setDockAutoHide] = useState(() => {
        try {
            const saved = localStorage.getItem('mindflow_dock_autohide');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (e) {
            return true;
        }
    });

    const handleToggleAlwaysOnTop = useCallback(async () => {
        try {
            const win = getCurrentWindow();
            const newState = !isAlwaysOnTop;
            await win.setAlwaysOnTop(newState);
            setIsAlwaysOnTop(newState);
        } catch (e) {
            console.error(e);
        }
    }, [isAlwaysOnTop]);

    const handleToggleWindow = useCallback(async () => {
        try {
            const win = getCurrentWindow();
            const visible = await win.isVisible();
            if (visible) {
                await win.hide();
            } else {
                await win.show();
                await win.setFocus();
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    const { shortcuts, updateShortcut } = useGlobalShortcuts(handleToggleAlwaysOnTop, handleToggleWindow);

    const mindMapRef = useRef<MindMapHandle>(null);

    const normalizeWindowBounds = useCallback(async () => {
        const win = getCurrentWindow();
        const [size, position, isMaximized, monitors] = await Promise.all([
            win.innerSize(),
            win.outerPosition(),
            win.isMaximized(),
            availableMonitors(),
        ]);

        if (isMaximized || monitors.length === 0) {
            return;
        }

        const monitor = monitors.find((candidate) =>
            rectsIntersect(
                position.x,
                position.y,
                Math.max(size.width, 1),
                Math.max(size.height, 1),
                candidate.workArea.position.x,
                candidate.workArea.position.y,
                candidate.workArea.size.width,
                candidate.workArea.size.height
            )
        ) ?? monitors[0];

        const { position: workAreaPos, size: workAreaSize } = monitor.workArea;
        const maxWidth = Math.max(1, workAreaSize.width - WINDOW_EDGE_PADDING * 2);
        const maxHeight = Math.max(1, workAreaSize.height - WINDOW_EDGE_PADDING * 2);
        const minUsableWidth = Math.min(maxWidth, Math.min(720, Math.max(480, Math.floor(workAreaSize.width * 0.28))));
        const minUsableHeight = Math.min(maxHeight, Math.min(520, Math.max(320, Math.floor(workAreaSize.height * 0.28))));

        const isTooSmall = size.width < minUsableWidth || size.height < minUsableHeight;
        const isOffScreen = !monitors.some((candidate) =>
            rectsIntersect(
                position.x,
                position.y,
                Math.max(size.width, 1),
                Math.max(size.height, 1),
                candidate.workArea.position.x,
                candidate.workArea.position.y,
                candidate.workArea.size.width,
                candidate.workArea.size.height
            )
        );

        if (!isTooSmall && !isOffScreen) {
            return;
        }

        const targetWidth = clamp(
            Math.min(1280, Math.floor(workAreaSize.width * 0.72)),
            minUsableWidth,
            maxWidth
        );
        const targetHeight = clamp(
            Math.min(820, Math.floor(workAreaSize.height * 0.8)),
            minUsableHeight,
            maxHeight
        );
        const targetX = workAreaPos.x + Math.floor((workAreaSize.width - targetWidth) / 2);
        const targetY = workAreaPos.y + Math.floor((workAreaSize.height - targetHeight) / 2);

        await win.setSize(new PhysicalSize(targetWidth, targetHeight));
        await win.setPosition(new PhysicalPosition(targetX, targetY));
    }, []);

    useEffect(() => {
        // Show window gracefully after mount to avoid "flash" of unpositioned state
        const initWindow = async () => {
            try {
                await normalizeWindowBounds();
            } catch (e) {
                console.error('Failed to normalize window bounds', e);
            }

            const win = getCurrentWindow();
            await win.show();
            await win.setFocus();
        };
        initWindow();

        // @ts-ignore
        // if (!window.__TAURI_INTERNALS__) {
        //     console.error("Tauri Internals not found");
        //     alert("DEBUG: Tauri API 未检测到！\n请检查您是否正在使用 Tauri 桌面窗口运行，而不是浏览器。");
        // }

        const unlisten = listen('open-settings', () => {
            setShowSettings(true);
        });
        return () => {
            unlisten.then(f => f());
        };
    }, [normalizeWindowBounds]);

    // Intro Animation Timer
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowIntroUI(false);
        }, 2000);
        return () => clearTimeout(timer);
    }, []);

    // Load from Storage
    useEffect(() => {
        try {
            const savedNotesStr = localStorage.getItem(STORAGE_KEY);
            const savedActiveId = localStorage.getItem(ACTIVE_ID_KEY);
            const savedDefaultTheme = localStorage.getItem(DEFAULT_THEME_KEY) as ThemeId;
            const savedDockPos = localStorage.getItem(DOCK_POS_KEY) as 'right' | 'bottom';
            const savedDockAutoHide = localStorage.getItem('mindflow_dock_autohide');

            if (savedDockPos) {
                setDockPosition(savedDockPos);
            }
            if (savedDockAutoHide !== null) {
                try {
                    setDockAutoHide(JSON.parse(savedDockAutoHide));
                } catch (e) {
                    // ignore
                }
            }

            if (savedDefaultTheme && THEMES[savedDefaultTheme]) {
                setDefaultTheme(savedDefaultTheme);
            }

            if (savedNotesStr) {
                const parsedNotes = JSON.parse(savedNotesStr);
                if (Array.isArray(parsedNotes) && parsedNotes.length > 0) {
                    // Migration: Ensure notes have themeId if coming from old version
                    const migratedNotes = parsedNotes.map((n: any) => ({
                        ...n,
                        themeId: n.themeId || 'night'
                    }));

                    // Do NOT sort by updatedAt here to respect user's manual order or previous state
                    setNotes(migratedNotes);

                    if (savedActiveId && migratedNotes.some((n: Note) => n.id === savedActiveId)) {
                        setActiveNoteId(savedActiveId);
                    } else {
                        setActiveNoteId(migratedNotes[0].id);
                    }
                } else {
                    // Empty array in storage
                    initFirstNote();
                }
            } else {
                // No storage
                initFirstNote();
            }
        } catch (e) {
            console.error("Failed to load notes", e);
            initFirstNote();
        } finally {
            setIsLoading(false);
        }
    }, []);

    const initFirstNote = () => {
        const newNote = createNewNote(defaultTheme, window.innerWidth, window.innerHeight);
        setNotes([newNote]);
        setActiveNoteId(newNote.id);
    };

    // Orientation Change Listener
    useEffect(() => {
        const handleResize = () => {
            const isPortrait = window.innerHeight > window.innerWidth;

            // Auto-switch layout on orientation change if needed
            // Requirement: "When vertical screen detected... changed to tree chart"
            setNotes(prev => prev.map(note => {
                if (note.id === activeNoteId) {
                    // If switching to Portrait and not already tree, switch
                    if (isPortrait && note.viewState.layout !== 'tree') {
                        // Close help if open
                        if (mindMapRef.current) {
                            mindMapRef.current.setHelpOpen(false);
                            // Also re-center to top-left to avoid overlap (handled by needsCentering)
                        }
                        return {
                            ...note,
                            viewState: {
                                ...note.viewState,
                                layout: 'tree',
                                needsCentering: true // Trigger re-centering logic in MindMap
                            }
                        };
                    }
                }
                return note;
            }));
        };

        window.addEventListener('resize', handleResize);
        // Initial check handled by createNewNote or saved state, but we can double check here? 
        // No, better to leave user control after load unless explicit resize happens.
        return () => window.removeEventListener('resize', handleResize);
    }, [activeNoteId]);

    // Auto Save - Strict dependency check and isLoading gate
    useEffect(() => {
        if (!isLoading) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
        }
    }, [notes, isLoading]);

    useEffect(() => {
        if (!isLoading && activeNoteId) {
            localStorage.setItem(ACTIVE_ID_KEY, activeNoteId);
        }
    }, [activeNoteId, isLoading]);

    useEffect(() => {
        localStorage.setItem(DEFAULT_THEME_KEY, defaultTheme);
    }, [defaultTheme]);

    useEffect(() => {
        localStorage.setItem(DOCK_POS_KEY, dockPosition);
    }, [dockPosition]);

    // Dock Auto Hide Storage
    useEffect(() => {
        localStorage.setItem('mindflow_dock_autohide', JSON.stringify(dockAutoHide));
    }, [dockAutoHide]);


    // Actions
    const handleCreateNote = (overrideTheme?: ThemeId) => {
        const themeToUse = overrideTheme || defaultTheme;
        // Pass screen dimensions to center the root
        const newNote = createNewNote(themeToUse, window.innerWidth, window.innerHeight);
        // Add to BEGINNING of array (Newest first)
        setNotes(prev => [newNote, ...prev]);
        setActiveNoteId(newNote.id);
    };

    const handleDeleteNote = (id?: string) => {
        const targetId = id || activeNoteId;
        if (!targetId) return;

        // Optional confirmation handled by caller or here
        if (!id && !confirm('确定要删除这个便签吗？')) return; // Confirm only for button click, context menu handles its own logic/assumption

        const newNotes = notes.filter(n => n.id !== targetId);
        setNotes(newNotes);

        // If we deleted the active note, switch to another one
        if (activeNoteId === targetId) {
            if (newNotes.length > 0) {
                setActiveNoteId(newNotes[0].id);
            } else {
                // Don't leave empty, create new immediately
                const newNote = createNewNote(defaultTheme, window.innerWidth, window.innerHeight);
                setNotes([newNote]);
                setActiveNoteId(newNote.id);
            }
        }
    };

    const handleUpdateNoteData = useCallback((newData: MindNode) => {
        setNotes(prev => prev.map(note => {
            if (note.id === activeNoteId) {
                return {
                    ...note,
                    root: newData,
                    title: newData.text || '未命名',
                    updatedAt: Date.now()
                };
            }
            return note;
        }));
    }, [activeNoteId]);

    const handleUpdateViewState = useCallback((viewState: ViewState) => {
        setNotes(prev => prev.map(note => {
            if (note.id === activeNoteId) {
                return { ...note, viewState };
            }
            return note;
        }));
    }, [activeNoteId]);

    const toggleLayout = () => {
        setNotes(prev => prev.map(note => {
            if (note.id === activeNoteId) {
                const newLayout = note.viewState.layout === 'tree' ? 'mindmap' : 'tree';
                // If switching to tree, maybe re-center? Optional.
                return {
                    ...note,
                    viewState: {
                        ...note.viewState,
                        layout: newLayout
                    }
                };
            }
            return note;
        }));
    };

    const handleThemeChange = (newThemeId: ThemeId) => {
        // If we click a theme bubble, update current note theme
        if (activeNoteId) {
            setNotes(prev => prev.map(note => {
                if (note.id === activeNoteId) {
                    return { ...note, themeId: newThemeId, themeColor: THEMES[newThemeId].buttonColor };
                }
                return note;
            }));
        }
    };

    // Dock Actions
    const handleReorderNotes = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        setNotes(prev => {
            const result = [...prev];
            const [removed] = result.splice(fromIndex, 1);
            result.splice(toIndex, 0, removed);
            return result;
        });
    };

    const handlePinNote = (id: string) => {
        setNotes(prev => {
            const index = prev.findIndex(n => n.id === id);
            if (index <= 0) return prev;
            const result = [...prev];
            const [removed] = result.splice(index, 1);
            result.unshift(removed);
            return result;
        });
    };

    // Helper for context menu actions
    const getNoteActions = (id: string) => {
        const note = notes.find(n => n.id === id);
        return {
            download: () => {
                if (note) {
                    const text = noteToMarkdown(note.root);
                    const blob = new Blob([text], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${note.title || 'note'}.md`;
                    a.click();
                }
            },
            copy: () => {
                if (note) {
                    const text = noteToMarkdown(note.root);
                    navigator.clipboard.writeText(text);
                }
            },
            delete: () => handleDeleteNote(id),
            pin: () => handlePinNote(id)
        };
    };


    // Drag and Drop Logic (Create New)
    const handleDragStart = (e: React.DragEvent, themeId: ThemeId) => {
        e.dataTransfer.setData("themeId", themeId);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOverNew(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        setIsDragOverNew(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOverNew(false);
        const themeId = e.dataTransfer.getData("themeId") as ThemeId;
        if (themeId && THEMES[themeId]) {
            setDefaultTheme(themeId);
            handleCreateNote(themeId);
        }
    };


    const handleCopyToClipboard = () => {
        const actions = activeNoteId ? getNoteActions(activeNoteId) : null;
        actions?.copy();
        if (actions) alert('已复制为 Markdown');
    };

    const handleDownloadMarkdown = () => {
        const actions = activeNoteId ? getNoteActions(activeNoteId) : null;
        actions?.download();
    };

    // derived
    const activeNote = notes.find(n => n.id === activeNoteId);
    const activeTheme = activeNote ? THEMES[activeNote.themeId] || THEMES['night'] : THEMES['night'];
    const currentLayout = activeNote?.viewState.layout || 'mindmap';

    // Adaptive color calculation
    const baseContrastColor = getContrastingTextColor(activeTheme.background);
    // Muted version for icons (using 60% opacity logic in styles, or passing rgba)
    // Actually, passing the base color allows components to apply opacity
    const isDarkTheme = baseContrastColor === '#ffffff';

    if (isLoading || !activeNote) return <div className="bg-neutral-900 w-screen h-screen"></div>;

    return (
        <div className="w-screen h-screen overflow-hidden relative font-sans transition-colors duration-500" style={{ backgroundColor: activeTheme.background }}>
            <TitleBar
                onOpenSettings={() => setShowSettings(true)}
                isAlwaysOnTop={isAlwaysOnTop}
                toggleAlwaysOnTop={handleToggleAlwaysOnTop}
                baseColor={baseContrastColor}
            />
            <div className="pt-0 h-full relative">

                {/* Main Workspace */}
                <MindMap
                    ref={mindMapRef}
                    key={activeNote.id}
                    data={activeNote.root}
                    viewState={activeNote.viewState}
                    theme={activeTheme}
                    isActive={true}
                    onChange={handleUpdateNoteData}
                    onViewStateChange={handleUpdateViewState}
                />

                {/* Top Left: New Note & Theme Selector & Layout Toggle */}
                <div className="fixed top-0 left-0 p-6 z-40 flex items-start gap-4 group/area">
                    {/* New Button */}
                    <div
                        className="relative"
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        <button
                            onClick={() => handleCreateNote()}
                            className={`
                    p-3 rounded-full shadow-lg transition-all duration-300 transform border
                    ${isDragOverNew ? 'scale-125 ring-4' : ''}
                    ${showIntroUI ? 'scale-100 opacity-100' : 'scale-90 opacity-0 group-hover/area:opacity-100 group-hover/area:scale-100'}
                `}
                            style={{
                                backgroundColor: THEMES[defaultTheme].buttonColor,
                                color: '#ffffff', // Plus button always uses theme color background, so white text is usually safe or need check? 
                                // Most theme buttonColors are bright/dark enough for white text. Let's keep white for now as per design.
                                borderColor: isDarkTheme ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                                // Drag ring color
                                // ringColor handled by tailwind class 'ring-white' above is static. Should be dynamic?
                                // Let's keep simple for the main action button.
                            }}
                            title="新建便签 (拖拽主题球到此可修改默认主题并新建)"
                        >
                            <Plus size={32} strokeWidth={3} />
                        </button>
                    </div>

                    {/* Theme Bubbles & Layout Toggle (Reveal on hover or intro) */}
                    <div className={`
             flex gap-2 pt-2 items-center transition-all duration-500 delay-75
             ${showIntroUI ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-10 group-hover/area:opacity-100 group-hover/area:translate-x-0'}
         `}>
                        {Object.values(THEMES).map(theme => (
                            <div
                                key={theme.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, theme.id)}
                                onClick={() => handleThemeChange(theme.id)}
                                className="w-8 h-8 rounded-full cursor-grab active:cursor-grabbing border-2 border-white/20 hover:scale-110 transition-transform shadow-md"
                                style={{ backgroundColor: theme.buttonColor }}
                                title={`切换主题: ${theme.name}`}
                            />
                        ))}

                        <div className="w-[1px] h-6 bg-white/20 mx-1"></div>

                        {/* Layout Toggle Button */}
                        <button
                            onClick={toggleLayout}
                            className="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all shadow-md hover:scale-110 opacity-40 hover:opacity-100"
                            style={{
                                borderColor: isDarkTheme ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                                color: baseContrastColor,
                                backgroundColor: isDarkTheme ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                            }}
                            title={currentLayout === 'mindmap' ? "切换为直角树状图 (目录模式)" : "切换为曲线思维导图"}
                        >
                            <GitGraph size={16} className={currentLayout === 'tree' ? "rotate-90" : ""} />
                        </button>
                    </div>
                </div>

                {/* Dock */}
                <Dock
                    notes={notes}
                    activeNoteId={activeNoteId || ''}
                    onSelectNote={setActiveNoteId}
                    onReorder={handleReorderNotes}
                    onAction={getNoteActions}
                    position={dockPosition}
                    onPositionChange={setDockPosition}
                    autoHide={dockAutoHide}
                />

            </div>
            {showSettings && (
                <Settings
                    onClose={() => setShowSettings(false)}
                    shortcuts={shortcuts}
                    onUpdateShortcut={updateShortcut}
                    dockAutoHide={dockAutoHide}
                    onToggleDockAutoHide={() => setDockAutoHide(!dockAutoHide)}
                />
            )}
        </div>
    );
};

export default App;
