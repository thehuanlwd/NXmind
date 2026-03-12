export type ThemeId = 'dawn' | 'noon' | 'dusk' | 'night' | 'dream';

export interface Theme {
  id: ThemeId;
  name: string;
  background: string; // Global background color
  lineColor: string;
  nodeColors: string[]; // Colors by depth
  textColor: string;
  buttonColor: string; // For the FAB
}

// 节点数据结构
export interface MindNode {
  id: string;
  text: string;
  children: MindNode[];
  parentId?: string | null; // 辅助字段，用于逻辑处理，不一定存储
  isRoot?: boolean;
}

// 视图状态，用于恢复用户离开时的样子
export interface ViewState {
  x: number;
  y: number;
  k: number; // 缩放比例
  focusedNodeId: string | null;
  needsCentering?: boolean; // 是否需要重新居中
  layout?: 'mindmap' | 'tree';
}

// 便签对象
export interface Note {
  id: string;
  title: string;
  root: MindNode;
  createdAt: number;
  updatedAt: number;
  viewState: ViewState;
  themeColor: string; //用于Dock图标颜色
  themeId: ThemeId; // 当前便签的主题
}

// D3 布局计算后的节点类型
export interface D3Node {
  data: MindNode;
  depth: number;
  x: number;
  y: number;
  parent: D3Node | null;
  children?: D3Node[];
}
