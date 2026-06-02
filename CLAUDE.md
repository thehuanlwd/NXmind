# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Mindflow Notes (便签导图) 是一个基于 Tauri 2.0 + React 19 的桌面应用，将便利贴的自由与思维导图的逻辑完美融合。采用无边框窗口设计，提供极简、流畅的思维整理体验。

## 技术栈

- **后端**: Rust + Tauri 2.0
- **前端**: React 19 + TypeScript + Vite
- **样式**: Tailwind CSS 4.x
- **可视化**: D3.js (树状布局和物理交互)
- **AI集成**: Google Gemini API

## 常用命令

### 开发
```bash
# 安装依赖
npm install

# 启动开发服务器 (热重载)
npm run tauri dev

# 仅启动前端开发服务器
npm run dev
```

### 构建
```bash
# 构建生产版本 (生成 Windows 安装包)
npm run tauri build

# 仅构建前端
npm run build
```

构建产物位于 `src-tauri/target/release/bundle/nsis/`

### 预览
```bash
npm run preview
```

## 核心架构

### 1. 数据结构 (types.ts)

- **MindNode**: 思维导图节点，递归树结构
  - `priority` (number | null): 优先级标记 1-5，null 表示无优先级
  - `completed` (boolean): 是否已完成
- **Note**: 便签对，包含根节点、主题、视图状态
- **ViewState**: 保存用户的缩放、平移、焦点状态
- **Theme**: 主题配色系统 (dawn/noon/dusk/night/dream)

### 2. 状态管理 (App.tsx)

应用采用 React 本地状态 + localStorage 持久化：
- `notes`: 所有便签数组
- `activeNoteId`: 当前激活的便签 ID
- `defaultTheme`: 默认主题
- `dockPosition`: Dock 位置 (right/bottom)
- `dockAutoHide`: Dock 自动隐藏开关

所有状态变更会自动保存到 localStorage，键名前缀为 `mindflow_`。

### 3. 核心组件

#### MindMap (components/MindMap.tsx)
- 使用 D3.js 计算布局 (tree/mindmap 两种模式)
- 支持节点拖拽、编辑、选择、删除
- 通过 `useMindMapLayout` 处理布局计算和视图变换
- 通过 `useMindMapInteraction` 处理用户交互逻辑
- 使用 `forwardRef` 暴露 `centerView` 和 `setHelpOpen` 方法给父组件

#### Dock (components/Dock.tsx)
- 便签缩略图列表，支持拖拽排序
- 右键菜单：置顶、下载、复制、删除
- 可切换位置 (右侧/底部) 和自动隐藏

#### TitleBar (components/TitleBar.tsx)
- 自定义标题栏 (因为窗口无边框)
- 提供窗口控制按钮和设置入口

#### Settings (components/Settings.tsx)
- 全局快捷键配置
- Dock 自动隐藏开关

### 4. Tauri 后端 (src-tauri/src/lib.rs)

- **插件集成**:
  - `tauri-plugin-window-state`: 自动保存/恢复窗口位置和大小
  - `tauri-plugin-single-instance`: 单例模式，防止多开
  - `tauri-plugin-global-shortcut`: 全局快捷键
  - `tauri-plugin-autostart`: 开机自启
  - `tauri-plugin-fs/dialog/notification/shell`: 文件系统、对话框、通知、Shell 命令

- **系统托盘**:
  - 左键点击托盘图标显示/聚焦主窗口
  - 右键菜单：显示主界面、设置、退出
  - 托盘菜单点击 "设置" 会发送 `open-settings` 事件到前端

- **窗口启动逻辑**:
  - 窗口初始 `visible: false` (tauri.conf.json)
  - 前端挂载后调用 `win.show()` 和 `win.setFocus()` 实现优雅显示

### 5. 布局模式

- **mindmap**: 曲线思维导图 (默认)
- **tree**: 直角树状图 (目录模式)
- 竖屏时自动切换为 tree 模式

### 6. 主题系统

内置 5 套 HSL 主题 (utils/helpers.ts):
- dawn (黎明)
- noon (正午)
- dusk (黄昏)
- night (深夜)
- dream (梦境)

每个主题包含背景色、线条色、节点色 (按深度)、文本色、按钮色。

### 7. 交互逻辑

- **Tab**: 创建子节点
- **Enter**: 创建同级节点
- **Backspace**: 删除节点 (内容为空时)
- **拖拽节点**: 重组结构
- **框选**: 多选节点 (Shift + 拖拽)
- **双击**: 编辑节点文本
- **优先级标记**:
  - `Ctrl + 1/2/3/4/5`: 设置优先级 (1-5)
  - `Ctrl + 0`: 取消优先级
  - 支持批量设置 (选中多个节点后使用快捷键)
  - 点击优先级图标切换完成状态 (绿色 ✓)
- **优先级视觉设计**:
  - 数字徽章：圆形彩色徽章，显示优先级数字
  - 优先级 1：红色，优先级 2：橙色，优先级 3：黄色，优先级 4：蓝色，优先级 5：灰色
  - 完成状态：绿色 ✓ 图标叠加在徽章右上角

### 8. 环境变量

项目使用 `.env` 文件配置 Gemini API Key:
```
GEMINI_API_KEY=your_api_key_here
```

Vite 配置中通过 `define` 注入到前端代码。

## 开发注意事项

1. **窗口状态**: 窗口位置、大小由 `tauri-plugin-window-state` 自动管理，无需手动保存
2. **单例锁**: 应用启动时会检查是否已有实例运行，如有则聚焦已有窗口
3. **视图状态**: 每个便签的缩放、平移、焦点状态独立保存在 `viewState` 中
4. **自动保存**: 所有数据变更会立即保存到 localStorage，无需手动触发
5. **布局计算**: D3 布局计算在 `useMindMapLayout` 中完成，结果缓存在 `layoutCache` 中
6. **性能优化**: 使用 `useCallback` 和 `useMemo` 避免不必要的重渲染

## 文件结构

```
mindflow/
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── lib.rs         # 主入口，插件初始化
│   │   └── main.rs        # 启动入口
│   ├── Cargo.toml         # Rust 依赖
│   └── tauri.conf.json    # Tauri 配置
├── components/            # React 组件
│   ├── MindMap.tsx       # 核心思维导图组件
│   ├── Dock.tsx          # 便签列表
│   ├── TitleBar.tsx      # 标题栏
│   ├── Settings.tsx      # 设置面板
│   ├── useMindMapLayout.ts      # 布局计算 Hook
│   └── useMindMapInteraction.ts # 交互逻辑 Hook
├── utils/                # 工具函数
│   ├── helpers.ts        # 主题、节点操作、Markdown 导出
│   └── useHistory.ts     # 撤销/重做 (未启用)
├── hooks/                # 自定义 Hooks
│   └── useGlobalShortcuts.ts # 全局快捷键管理
├── App.tsx               # 主应用组件
├── types.ts              # TypeScript 类型定义
├── index.tsx             # 入口文件
├── vite.config.ts        # Vite 配置
└── package.json          # 前端依赖
```

## 调试技巧

- Tauri 开发模式下会自动启用 DevTools
- Rust 日志通过 `tauri-plugin-log` 输出 (仅 debug 模式)
- 前端状态可通过 React DevTools 查看
- localStorage 数据可在浏览器 DevTools 中查看 (键名前缀 `mindflow_`)
