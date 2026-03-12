import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
// If autostart plugin import fails during dev (no types), we might need to ignore ts error or declare module
// For now assuming it works or we catch error

interface SettingsProps {
    onClose: () => void;
    shortcuts: {
        alwaysOnTop: string;
        toggleWindow: string;
    };
    onUpdateShortcut: (key: 'alwaysOnTop' | 'toggleWindow', newShortcut: string) => Promise<void>;
    dockAutoHide: boolean;
    onToggleDockAutoHide: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onClose, shortcuts, onUpdateShortcut, dockAutoHide, onToggleDockAutoHide }) => {
    const [autoStart, setAutoStart] = useState(false);
    const [recordingKey, setRecordingKey] = useState<'alwaysOnTop' | 'toggleWindow' | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        checkAutoStart();
    }, []);

    // Clear error after 3s
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    const checkAutoStart = async () => {
        try {
            const enabled = await isEnabled();
            setAutoStart(enabled);
        } catch (e) {
            console.error("Autostart check failed", e);
        }
    };

    const toggleAutoStart = async () => {
        try {
            if (autoStart) {
                await disable();
                setAutoStart(false);
            } else {
                await enable();
                setAutoStart(true);
            }
        } catch (e) {
            console.error("Autostart toggle failed", e);
        }
    };

    const handleKeyDown = async (e: React.KeyboardEvent, key: 'alwaysOnTop' | 'toggleWindow') => {
        e.preventDefault();
        e.stopPropagation();

        const modifiers = [];
        if (e.ctrlKey) modifiers.push('Ctrl');
        if (e.altKey) modifiers.push('Alt');
        if (e.shiftKey) modifiers.push('Shift');
        if (e.metaKey) modifiers.push('Command');

        const keyName = e.key.toUpperCase();
        // Ignore modifier key presses alone
        if (['CONTROL', 'ALT', 'SHIFT', 'META'].includes(keyName)) return;

        const newShortcut = modifiers.length > 0 ? `${modifiers.join('+')}+${keyName}` : keyName;

        try {
            await onUpdateShortcut(key, newShortcut);
            setRecordingKey(null);
        } catch (err: any) {
            setError("快捷键冲突或无效");
            setRecordingKey(null);
        }
    };

    return (
        <div className="fixed inset-0 bg-neutral-900/95 backdrop-blur-sm z-50 flex items-center justify-center animate-in fade-in duration-200">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 w-96 shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>

                <h2 className="text-xl font-medium text-white mb-6">设置</h2>

                <div className="space-y-6">
                    {/* Startup */}
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-neutral-200">开机自启</span>
                            <span className="text-xs text-neutral-500">跟随系统启动应用</span>
                        </div>
                        <button
                            onClick={toggleAutoStart}
                            className={`w-12 h-6 rounded-full transition-colors relative ${autoStart ? 'bg-sky-500' : 'bg-neutral-700'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${autoStart ? 'left-7' : 'left-1'}`} />
                        </button>
                    </div>

                    {/* Dock Auto Hide */}
                    <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
                        <div className="flex flex-col">
                            <span className="text-neutral-200">Dock 自动隐藏</span>
                            <span className="text-xs text-neutral-500">鼠标移出时隐藏底栏/侧栏</span>
                        </div>
                        <button
                            onClick={onToggleDockAutoHide}
                            className={`w-12 h-6 rounded-full transition-colors relative ${dockAutoHide ? 'bg-sky-500' : 'bg-neutral-700'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${dockAutoHide ? 'left-7' : 'left-1'}`} />
                        </button>
                    </div>

                    {/* Shortcuts */}
                    <div className="space-y-3 pt-4 border-t border-neutral-800">
                        <h3 className="text-sm font-medium text-neutral-400 mb-2 flex justify-between">
                            <span>快捷键</span>
                            {error && <span className="text-red-400 text-xs animate-pulse">{error}</span>}
                        </h3>

                        <div className="flex items-center justify-between bg-neutral-800/50 p-3 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-colors">
                            <span className="text-neutral-300">置顶窗口</span>
                            <button
                                onClick={() => setRecordingKey('alwaysOnTop')}
                                onKeyDown={(e) => recordingKey === 'alwaysOnTop' && handleKeyDown(e, 'alwaysOnTop')}
                                className={`text-xs font-mono px-2 py-1 rounded min-w-[60px] text-center transition-colors ${recordingKey === 'alwaysOnTop' ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}
                            >
                                {recordingKey === 'alwaysOnTop' ? '按下按键...' : shortcuts.alwaysOnTop}
                            </button>
                        </div>

                        <div className="flex items-center justify-between bg-neutral-800/50 p-3 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-colors">
                            <span className="text-neutral-300">主界面显示/隐藏</span>
                            <div className="flex flex-col items-end">
                                <button
                                    onClick={() => setRecordingKey('toggleWindow')}
                                    onKeyDown={(e) => recordingKey === 'toggleWindow' && handleKeyDown(e, 'toggleWindow')}
                                    className={`text-xs font-mono px-2 py-1 rounded min-w-[60px] text-center transition-colors ${recordingKey === 'toggleWindow' ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}
                                >
                                    {recordingKey === 'toggleWindow' ? '按下按键...' : shortcuts.toggleWindow}
                                </button>
                            </div>
                        </div>

                        <div className="text-[10px] text-neutral-500 text-right mt-1">* 点击快捷键可修改</div>
                    </div>
                </div>

                <div className="mt-8 pt-4 border-t border-neutral-800 text-center text-xs text-neutral-600">
                    NXmind 心流导图 v0.5.6
                </div>
            </div>
        </div>
    );
};
