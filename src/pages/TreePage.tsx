import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  Background,
  BackgroundVariant,
  useViewport,
  useNodes,
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useFamilyStore } from '../store/familyStore';
import { getFullName, getLifeSpan, formatAge, getRelationshipText } from '../utils';
import { convertLocalSrc } from '../utils/tauri';
import type { Person } from '../types';
import './TreePage.css';

// ==================== 自定义节点组件 ====================

interface PersonNodeData {
  person: Person;
  isPerspective: boolean;
  showCoordinates?: boolean;
}

function PersonNode({ data }: { data: PersonNodeData }) {
  const { person, isPerspective, showCoordinates } = data;
  const navigate = useNavigate();
  const project = useFamilyStore((state) => state.project);
  const perspectiveId = project?.meta.defaultPerspectiveId;
  const relationText = getRelationshipText(person.id, perspectiveId, project?.persons || {});

  // 使用 useReactFlow 更新自身节点坐标
  const { setNodes } = useReactFlow();

  // 使用 useNodes 动态获取自身的实时坐标，在拖拽时实现 real-time 刷新显示
  const nodes = useNodes();
  const selfNode = nodes.find(n => n.id === person.id);
  const posX = selfNode?.position?.x ?? 0;
  const posY = selfNode?.position?.y ?? 0;

  const [isEditing, setIsEditing] = useState(false);
  const [editX, setEditX] = useState('');
  const [editY, setEditY] = useState('');

  // 节点被拖拽时，若非编辑态，则自动更新输入框中的预设值
  useEffect(() => {
    if (!isEditing) {
      setEditX(Math.round(posX).toString());
      setEditY(Math.round(posY).toString());
    }
  }, [posX, posY, isEditing]);

  const handleUpdateCoordinates = (newX: number, newY: number) => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (n.id === person.id) {
          return {
            ...n,
            position: { x: newX, y: newY },
          };
        }
        return n;
      })
    );
  };

  const handleSave = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const newX = parseFloat(editX);
    const newY = parseFloat(editY);
    if (!isNaN(newX) && !isNaN(newY)) {
      handleUpdateCoordinates(newX, newY);
    }
    setIsEditing(false);
  };

  const handleCancel = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setEditX(Math.round(posX).toString());
    setEditY(Math.round(posY).toString());
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleSave(e);
    } else if (e.key === 'Escape') {
      handleCancel(e as any);
    }
  };

  const fullName = getFullName(person.surname, person.givenName) || '未命名';

  const genderText = person.gender === 'male' ? '男' : '女';
  let subtitle = genderText;

  if (person.isAlive) {
    const age = person.birthDateSolar ? formatAge(person.birthDateSolar) : '';
    if (age) {
      subtitle += ` · ${age}`;
    }
  } else {
    const lifeSpan = getLifeSpan(person.birthDateSolar, person.deathDateSolar, person.isAlive);
    if (lifeSpan) {
      subtitle += ` · ${lifeSpan}`;
    }
  }

  return (
    <div
      className={`tree-person-node ${person.gender} ${isPerspective ? 'perspective' : ''}`}
      onDoubleClick={() => navigate(`/person/${person.id}`)}
    >
      <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />

      {isPerspective && (
        <div className="tree-node-perspective-tag">★</div>
      )}

      {/* 悬停关系气泡 */}
      {relationText && (
        <div className="tree-node-relation-badge">
          {relationText}
        </div>
      )}

      {/* 配偶左右连接点（双向，支持男左女右与女左男右） */}
      <Handle type="source" position={Position.Right} id="right-source" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="right-target" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="left-source" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="left-target" style={{ opacity: 0 }} />

      <div className="tree-node-avatar">
        {person.avatar ? (
          <img src={convertLocalSrc(person.avatar)} alt={fullName} />
        ) : (
          person.surname
        )}
      </div>
      <div className="tree-node-name">{fullName}</div>
      <div className="tree-node-lifespan">{subtitle}</div>

      {showCoordinates && (
        isEditing ? (
          <div
            className="tree-node-coordinate-input-container"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="number"
              className="coordinate-input"
              value={editX}
              onChange={(e) => setEditX(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="X"
              autoFocus
            />
            <span className="coordinate-comma">,</span>
            <input
              type="number"
              className="coordinate-input"
              value={editY}
              onChange={(e) => setEditY(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Y"
            />
            <button className="btn-coordinate-ok" onClick={handleSave}>✓</button>
            <button className="btn-coordinate-cancel" onClick={handleCancel}>✗</button>
          </div>
        ) : (
          <div
            className="tree-node-coordinate clickable"
            onClick={(e) => {
              e.stopPropagation();
              setEditX(Math.round(posX).toString());
              setEditY(Math.round(posY).toString());
              setIsEditing(true);
            }}
            title="点击手动输入绝对坐标"
          >
            ({Math.round(posX)}, {Math.round(posY)})
          </div>
        )
      )}

      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  person: PersonNode as any,
};
// 递归判断某个节点是否是 targetId (默认主视角) 的直系祖先（即 targetId 是该节点的子嗣/子孙）
const isPerspectiveDescendant = (
  startPersonId: string,
  targetId: string,
  personsMap: Record<string, Person>
): boolean => {
  if (startPersonId === targetId) return true;
  const person = personsMap[startPersonId];
  if (!person) return false;

  const children = person.relations.children || [];
  return children.some(child => isPerspectiveDescendant(child.id, targetId, personsMap));
};
// 坐标系轴线与原点绘制组件
function CoordinateAxes() {
  const { x, y } = useViewport();

  return (
    <svg className="coordinate-axes-overlay">
      {/* Y 轴 (垂直线) */}
      <line
        x1={x}
        y1={0}
        x2={x}
        y2="100%"
        stroke="oklch(60% 0.15 20 / 0.45)"
        strokeWidth={1.5}
        strokeDasharray="4,4"
      />
      {/* X 轴 (水平线) */}
      <line
        x1={0}
        y1={y}
        x2="100%"
        y2={y}
        stroke="oklch(60% 0.15 250 / 0.45)"
        strokeWidth={1.5}
        strokeDasharray="4,4"
      />
      {/* 原点 (0,0) 实心点 */}
      <circle
        cx={x}
        cy={y}
        r={5}
        fill="oklch(55% 0.16 140)"
        stroke="#ffffff"
        strokeWidth={1.5}
      />
      {/* (0,0) 坐标标签 */}
      <text
        x={x + 10}
        y={y - 10}
        fill="var(--color-text-secondary)"
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        (0,0)
      </text>
    </svg>
  );
}

// ==================== 主组件 ====================

function TreePageContent() {
  const navigate = useNavigate();
  const { project, getPersonsList, addPerson, setRelation, updatePerson, deletePerson, currentFilePath, saveCustomLayout } = useFamilyStore();
  const persons = getPersonsList();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const hasCustomLayout = !!(project?.customLayout && Object.keys(project.customLayout).length > 0);

  const applyCustomLayout = useCallback(() => {
    if (!project?.customLayout) return;
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        const pos = project.customLayout?.[node.id];
        if (pos) {
          return {
            ...node,
            position: { x: pos.x, y: pos.y },
          };
        }
        return node;
      })
    );
  }, [project?.customLayout, setNodes]);

  const handleNodeDragStop = useCallback((_event: any, _node: Node, currentNodes: Node[]) => {
    const layout: Record<string, { x: number; y: number }> = {};
    currentNodes.forEach((node) => {
      layout[node.id] = {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      };
    });
    saveCustomLayout(layout);
  }, [saveCustomLayout]);

  const hasAppliedCustomLayoutRef = useRef(false);

  const [showCoordinates, setShowCoordinates] = useState(false);
  const showCoordinatesRef = useRef(showCoordinates);

  useEffect(() => {
    showCoordinatesRef.current = showCoordinates;
  }, [showCoordinates]);

  // 当坐标系开启状态变化时，动态更新所有 node.data 中的 showCoordinates 状态，保留其现有的坐标位置
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          showCoordinates,
        },
      }))
    );
  }, [showCoordinates, setNodes]);

  // 当节点选中状态变化时，动态更新连接该节点的边（由选中节点流向其父母、子女和配偶）以及层级与透明度
  useEffect(() => {
    const selectedNode = nodes.find((n) => n.selected);
    if (!selectedNode) {
      setEdges((prevEdges) => {
        const nextEdges = prevEdges.map((edge) => {
          const nextStyle = { ...edge.style };
          const isSpouse = edge.id.startsWith('spouse-');
          const isAdopt = edge.id.startsWith('adopt-');
          nextStyle.stroke = isSpouse ? '#71717a' : '#b1b1b7';
          nextStyle.strokeWidth = isAdopt ? 1.5 : 2;
          delete nextStyle.opacity;
          return {
            ...edge,
            animated: false,
            className: '',
            style: nextStyle,
            markerStart: undefined,
            markerEnd: undefined,
          };
        });
        // 恢复默认的层级排序：配偶线在最顶层
        return [...nextEdges].sort((a, b) => {
          const scoreA = a.id.startsWith('spouse-') ? 2 : 0;
          const scoreB = b.id.startsWith('spouse-') ? 2 : 0;
          return scoreA - scoreB;
        });
      });
      return;
    }

    const selectedId = selectedNode.id;
    const person = project?.persons[selectedId];
    if (!person) return;

    // 父母：生父、生母、养父、养母
    const parents = [
      person.relations.father,
      person.relations.adoptiveFather,
      person.relations.mother,
      person.relations.adoptiveMother,
    ].filter(Boolean) as string[];

    // 子女
    const children = (person.relations.children || []).map((c) => c.id);

    setEdges((prevEdges) => {
      const nextEdges = prevEdges.map((edge) => {
        const isSpouseEdge = edge.id.startsWith('spouse-');

        // 父母 -> 选中节点：由选中的流向父母（逆向流动）
        const isParentEdge = parents.includes(edge.source) && edge.target === selectedId;
        // 选中节点 -> 子女：由选中的流向子女（顺向流动）
        const isChildEdge = edge.source === selectedId && children.includes(edge.target);
        // 选中节点与配偶：由选中的流向配偶
        const isCurrentSpouseEdge = isSpouseEdge && (edge.source === selectedId || edge.target === selectedId);

        if (isParentEdge) {
          // 父母：流向父母（逆流），荧光绿，带指向父母的 markerStart 箭头
          return {
            ...edge,
            animated: false,
            className: 'edge-flow-reverse',
            style: {
              ...edge.style,
              stroke: 'oklch(70% 0.17 140)', // 父母为荧光绿
              strokeWidth: 3,
              opacity: 1.0,
            },
            markerStart: {
              type: MarkerType.ArrowClosed,
              color: 'oklch(70% 0.17 140)',
              width: 12,
              height: 12,
            },
            markerEnd: undefined,
          };
        } else if (isChildEdge) {
          // 子女：流向子女（顺流），荧光蓝，带指向子女的 markerEnd 箭头
          return {
            ...edge,
            animated: false,
            className: 'edge-flow-forward',
            style: {
              ...edge.style,
              stroke: 'oklch(65% 0.2 240)', // 子女为荧光蓝
              strokeWidth: 3,
              opacity: 1.0,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: 'oklch(65% 0.2 240)',
              width: 12,
              height: 12,
            },
            markerStart: undefined,
          };
        } else if (isCurrentSpouseEdge) {
          // 配偶：流向配偶，荧光粉，带流向配偶的箭头
          const isForward = selectedId === edge.source;
          const spouseColor = 'oklch(65% 0.22 350)'; // 配偶为荧光粉
          return {
            ...edge,
            animated: false,
            className: isForward ? 'edge-flow-forward' : 'edge-flow-reverse',
            style: {
              ...edge.style,
              stroke: spouseColor,
              strokeWidth: 3,
              opacity: 1.0,
            },
            markerEnd: isForward ? {
              type: MarkerType.ArrowClosed,
              color: spouseColor,
              width: 12,
              height: 12,
            } : undefined,
            markerStart: !isForward ? {
              type: MarkerType.ArrowClosed,
              color: spouseColor,
              width: 12,
              height: 12,
            } : undefined,
          };
        } else {
          // 其他无关连线，不透明度调至 10%
          const nextStyle = { ...edge.style };
          const isSpouse = edge.id.startsWith('spouse-');
          const isAdopt = edge.id.startsWith('adopt-');
          nextStyle.stroke = isSpouse ? '#71717a' : '#b1b1b7';
          nextStyle.strokeWidth = isAdopt ? 1.5 : 2;
          nextStyle.opacity = 0.1;
          return {
            ...edge,
            animated: false,
            className: '',
            style: nextStyle,
            markerStart: undefined,
            markerEnd: undefined,
          };
        }
      });

      // 渲染排序规则：
      // 1. 无关普通亲子连线：score = 0
      // 2. 有流动动画的亲子连线：score = 1
      // 3. 无关配偶连线：score = 2
      // 4. 有流动动画的配偶连线：score = 3
      // 这能完美保障有动画的连线在普通线上层，且配偶连线永远处于最最顶层渲染！
      return [...nextEdges].sort((a, b) => {
        const isSpouseA = a.id.startsWith('spouse-');
        const isSpouseB = b.id.startsWith('spouse-');
        const isAnimA = a.className.startsWith('edge-flow-');
        const isAnimB = b.className.startsWith('edge-flow-');

        const scoreA = (isSpouseA ? 2 : 0) + (isAnimA ? 1 : 0);
        const scoreB = (isSpouseB ? 2 : 0) + (isAnimB ? 1 : 0);
        return scoreA - scoreB;
      });
    });
  }, [nodes, project?.persons, setEdges]);

  // 智能自动修补关系数据（历史数据全局自动治愈）
  useEffect(() => {
    if (!project) return;
    const personsList = Object.values(project.persons);
    let hasAutoRepaired = false;

    // 先克隆一份 relations 用于安全修补，防止在循环中修改原始引用引发渲染冲突
    const tempRelationsMap: Record<string, any> = {};
    personsList.forEach(p => {
      tempRelationsMap[p.id] = JSON.parse(JSON.stringify(p.relations));
    });

    personsList.forEach((person) => {
      const pRelations = tempRelationsMap[person.id];

      // 1. 只有生母且无生父，且生母有且仅有一个配偶，自动补齐生父
      if (!pRelations.father && pRelations.mother) {
        const motherObj = project.persons[pRelations.mother];
        if (motherObj && motherObj.relations.spouses && motherObj.relations.spouses.length === 1) {
          const autoFatherId = motherObj.relations.spouses[0].id;
          pRelations.father = autoFatherId;
          hasAutoRepaired = true;
        }
      }

      // 2. 只有生父且无生母，且生父有且仅有一个配偶，自动补齐生母
      if (!pRelations.mother && pRelations.father) {
        const fatherObj = project.persons[pRelations.father];
        if (fatherObj && fatherObj.relations.spouses && fatherObj.relations.spouses.length === 1) {
          const autoMotherId = fatherObj.relations.spouses[0].id;
          pRelations.mother = autoMotherId;
          hasAutoRepaired = true;
        }
      }
    });

    // 3. 补齐生父母的 children 列表中遗漏的当前子女，以及生父生母之间的夫妻配偶关系
    personsList.forEach((person) => {
      const pRelations = tempRelationsMap[person.id];
      const fatherId = pRelations.father;
      const motherId = pRelations.mother;

      // 若有生父，确保生父的 children 列表中有当前子女
      if (fatherId && tempRelationsMap[fatherId]) {
        const fRels = tempRelationsMap[fatherId];
        fRels.children = fRels.children || [];
        if (!fRels.children.some((c: any) => c.id === person.id)) {
          fRels.children.push({ id: person.id, type: 'biological' });
          hasAutoRepaired = true;
        }
      }

      // 若有生母，确保生母的 children 列表中有当前子女
      if (motherId && tempRelationsMap[motherId]) {
        const mRels = tempRelationsMap[motherId];
        mRels.children = mRels.children || [];
        if (!mRels.children.some((c: any) => c.id === person.id)) {
          mRels.children.push({ id: person.id, type: 'biological' });
          hasAutoRepaired = true;
        }
      }

      // 若同时有生父和生母，确保父母双方互为 spouses 配偶
      if (fatherId && motherId && tempRelationsMap[fatherId] && tempRelationsMap[motherId]) {
        const fRels = tempRelationsMap[fatherId];
        const mRels = tempRelationsMap[motherId];

        fRels.spouses = fRels.spouses || [];
        mRels.spouses = mRels.spouses || [];

        if (!fRels.spouses.some((s: any) => s.id === motherId)) {
          fRels.spouses.push({ id: motherId, type: 'married' });
          hasAutoRepaired = true;
        }
        if (!mRels.spouses.some((s: any) => s.id === fatherId)) {
          mRels.spouses.push({ id: fatherId, type: 'married' });
          hasAutoRepaired = true;
        }
      }
    });

    if (hasAutoRepaired) {
      personsList.forEach((p) => {
        const repairedRels = tempRelationsMap[p.id];
        // 仅当关系确实发生变更时才进行 update，大幅提高渲染平滑度
        if (JSON.stringify(p.relations) !== JSON.stringify(repairedRels)) {
          updatePerson(p.id, { relations: repairedRels });
        }
      });
    }
  }, [project, updatePerson]);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    personId: string;
  } | null>(null);

  // 删除确认对话框
  const [dialog, setDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // 从人物数据构建节点和边
  const buildGraph = useCallback(() => {
    const personsList = Object.values(project?.persons || {});
    if (personsList.length === 0) return;

    const perspectiveId = project?.meta.defaultPerspectiveId;

    const graphNodes: Node[] = personsList.map((person) => ({
      id: person.id,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        person,
        isPerspective: person.id === perspectiveId,
        showCoordinates: showCoordinatesRef.current,
      },
    }));

    const graphEdges: Edge[] = [];
    const edgeSet = new Set<string>(); // 防止重复边

    personsList.forEach((person) => {
      // 父子关系
      if (person.relations.father) {
        const key = `${person.relations.father}->${person.id}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graphEdges.push({
            id: key,
            source: person.relations.father,
            target: person.id,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            type: 'smoothstep',
            style: { stroke: '#b1b1b7', strokeWidth: 2 },
            animated: false,
          });
        }
      }
      if (person.relations.mother) {
        const key = `${person.relations.mother}->${person.id}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graphEdges.push({
            id: key,
            source: person.relations.mother,
            target: person.id,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            type: 'smoothstep',
            style: { stroke: '#b1b1b7', strokeWidth: 2 },
            animated: false,
          });
        }
      }

      // 养父母
      if (person.relations.adoptiveFather) {
        const key = `adopt-f-${person.relations.adoptiveFather}->${person.id}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graphEdges.push({
            id: key,
            source: person.relations.adoptiveFather,
            target: person.id,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            type: 'smoothstep',
            style: { stroke: '#b1b1b7', strokeWidth: 1.5, strokeDasharray: '6,4' },
          });
        }
      }
      if (person.relations.adoptiveMother) {
        const key = `adopt-m-${person.relations.adoptiveMother}->${person.id}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graphEdges.push({
            id: key,
            source: person.relations.adoptiveMother,
            target: person.id,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            type: 'smoothstep',
            style: { stroke: '#b1b1b7', strokeWidth: 1.5, strokeDasharray: '6,4' },
          });
        }
      }

      // 配偶关系（水平虚线，男在左 sourceHandle='right'，女在右 targetHandle='left'）
      person.relations.spouses.forEach((spouse) => {
        const spouseObj = project?.persons[spouse.id];
        if (!spouseObj) return;

        let sourceId = person.id;
        let targetId = spouseObj.id;

        if (person.gender === 'male' && spouseObj.gender === 'female') {
          sourceId = person.id;
          targetId = spouseObj.id;
        } else if (person.gender === 'female' && spouseObj.gender === 'male') {
          sourceId = spouseObj.id;
          targetId = person.id;
        } else {
          // 同性别 fallback 排序
          const ids = [person.id, spouseObj.id].sort();
          sourceId = ids[0];
          targetId = ids[1];
        }

        const key = `spouse-${sourceId}-${targetId}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graphEdges.push({
            id: key,
            source: sourceId,
            target: targetId,
            sourceHandle: 'right',
            targetHandle: 'left',
            type: 'straight',
            style: {
              stroke: '#71717a', // 加深的暗灰色，确保即使下层有线穿过也能清晰显示虚线
              strokeWidth: 2,
              strokeDasharray: '4,4',
            },
            label: '配偶',
            labelStyle: { fontSize: 10, fill: '#71717a' },
          });
        }
      });
    });



    // ====== 全新 Reingold-Tilford 树形布局算法实现 ======
    const layouted = graphNodes;
    const nodeMap = new Map(layouted.map(n => [n.id, n]));

    // 1. 递归计算每位成员相对于视角节点的代际层级，从而决定 Y 轴坐标（代际高度）
    const generationLevels: Record<string, number> = {};
    if (perspectiveId) {
      generationLevels[perspectiveId] = 0;
      const queue = [perspectiveId];
      const visited = new Set<string>([perspectiveId]);
      while (queue.length > 0) {
        const currId = queue.shift()!;
        const currLevel = generationLevels[currId];
        const person = project?.persons[currId];
        if (person) {
          // 生父母 / 养父母 (gen - 1)
          const father = person.relations.father || person.relations.adoptiveFather;
          const mother = person.relations.mother || person.relations.adoptiveMother;
          if (father && !visited.has(father)) {
            generationLevels[father] = currLevel - 1;
            visited.add(father);
            queue.push(father);
          }
          if (mother && !visited.has(mother)) {
            generationLevels[mother] = currLevel - 1;
            visited.add(mother);
            queue.push(mother);
          }
          // 配偶 (gen 相同)
          if (person.relations.spouses) {
            person.relations.spouses.forEach(s => {
              if (!visited.has(s.id)) {
                generationLevels[s.id] = currLevel;
                visited.add(s.id);
                queue.push(s.id);
              }
            });
          }
          // 子嗣 (gen + 1)
          const children = person.relations.children || [];
          children.forEach(c => {
            if (!visited.has(c.id)) {
              generationLevels[c.id] = currLevel + 1;
              visited.add(c.id);
              queue.push(c.id);
            }
          });
        }
      }
    }

    // 3. 辅助判断：提取用于边界碰撞和推移的代表性“主血亲节点”
    const isPrimaryNode = (nodeId: string): boolean => {
      const node = nodeMap.get(nodeId);
      if (!node) return false;
      const person = (node.data as any)?.person;
      if (!person) return false;

      const hasParents = !!(person.relations.father || person.relations.mother || person.relations.adoptiveFather || person.relations.adoptiveMother);
      if (hasParents) return true;

      const spouses = person.relations.spouses || [];
      if (spouses.length > 0) {
        const spouseObj = project?.persons[spouses[0].id];
        if (spouseObj) {
          const spouseHasParents = !!(spouseObj.relations.father || spouseObj.relations.mother || spouseObj.relations.adoptiveFather || spouseObj.relations.adoptiveMother);
          if (spouseHasParents) return false;
        }
      }

      if (person.gender === 'female' && spouses.length > 0) {
        return false;
      }

      return true;
    };

    // 4. 递归子树布局（Reingold-Tilford 核心解算）
    const layoutSubtree = (
      personId: string,
      currentY: number
    ): {
      positions: Record<string, number>;
      contour: Record<number, { left: number; right: number }>;
    } => {
      const person = project?.persons[personId];
      const subPositions: Record<string, number> = {};
      const subContour: Record<number, { left: number; right: number }> = {};

      if (!person) {
        return { positions: subPositions, contour: subContour };
      }

      const node = nodeMap.get(personId);
      if (node) {
        node.position.y = currentY;
      }

      // 本人及配偶组成的家庭块
      const spouses = person.relations.spouses || [];
      const hasSpouse = spouses.length > 0;

      subPositions[personId] = 0;
      let familyLeft = -70;
      let familyRight = 70;
      let familyCenter = 0;

      if (hasSpouse) {
        const spouseId = spouses[0].id;
        subPositions[spouseId] = 200;
        familyRight = 270;
        familyCenter = 100;
        const spouseNode = nodeMap.get(spouseId);
        if (spouseNode) {
          spouseNode.position.y = currentY;
        }
      }

      subContour[currentY] = { left: familyLeft, right: familyRight };

      // 递归计算子代
      const children = person.relations.children || [];
      if (children.length > 0) {
        // 子嗣排序：寻找包含主脉视角人物的子代作为中心锚点，其他手足左右交错排序，使主视角支系天然处于中心位置
        const childrenObj = [...children].map(c => project?.persons[c.id]).filter(Boolean) as Person[];
        let anchorIndex = -1;
        if (perspectiveId) {
          anchorIndex = childrenObj.findIndex(c => isPerspectiveDescendant(c.id, perspectiveId, project?.persons || {}));
        }

        let sortedChildren: Person[] = [];
        if (anchorIndex !== -1) {
          const anchor = childrenObj[anchorIndex];
          const others = childrenObj.filter((_, idx) => idx !== anchorIndex);

          others.sort((a, b) => {
            const dateA = a.birthDateSolar ? new Date(a.birthDateSolar).getTime() : Infinity;
            const dateB = b.birthDateSolar ? new Date(b.birthDateSolar).getTime() : Infinity;
            if (dateA !== dateB) return dateA - dateB;
            return a.createdAt.localeCompare(b.createdAt);
          });

          const leftSide: Person[] = [];
          const rightSide: Person[] = [];
          if (others.length === 1) {
            // 仅有两个手足时，将旁系手足放在右边，主脉锚点放在左边
            rightSide.push(others[0]);
          } else {
            others.forEach((sib, index) => {
              if (index % 2 === 0) {
                leftSide.unshift(sib);
              } else {
                rightSide.push(sib);
              }
            });
          }
          sortedChildren = [...leftSide, anchor, ...rightSide];
        } else {
          sortedChildren = childrenObj;
          sortedChildren.sort((a, b) => {
            const dateA = a.birthDateSolar ? new Date(a.birthDateSolar).getTime() : Infinity;
            const dateB = b.birthDateSolar ? new Date(b.birthDateSolar).getTime() : Infinity;
            if (dateA !== dateB) return dateA - dateB;
            return a.createdAt.localeCompare(b.createdAt);
          });
        }

        // 递归子树布局时，手足之间纵向（Y轴）引入 50px 阶梯偏移
        const childLayouts = sortedChildren.map((c, index) =>
          layoutSubtree(c.id, currentY + 200 + index * 50)
        );
        const childOffsets: number[] = new Array(childLayouts.length).fill(0);

        // 从左往右通过 contours 消除子树重合
        for (let i = 1; i < childLayouts.length; i++) {
          const prevLayout = childLayouts[i - 1];
          const currLayout = childLayouts[i];
          const prevOffset = childOffsets[i - 1];

          let maxShift = 0;
          const prevYLevels = Object.keys(prevLayout.contour).map(Number);
          const currYLevels = Object.keys(currLayout.contour).map(Number);

          // 全面检测纵向落在 150px 内的所有可能重合的高度层级
          prevYLevels.forEach(yPrev => {
            currYLevels.forEach(yCurr => {
              if (Math.abs(yPrev - yCurr) < 150) {
                const prevRight = prevLayout.contour[yPrev].right + prevOffset;
                const currLeft = currLayout.contour[yCurr].left;
                const gap = 120; // 严丝合缝的安全留白，卡片间距 120px
                const shift = prevRight + gap - currLeft;
                if (shift > maxShift) {
                  maxShift = shift;
                }
              }
            });
          });

          childOffsets[i] = maxShift;
        }

        // 双数和单数都完美求其物理中心
        const firstChildX = childOffsets[0];
        const lastChildX = childOffsets[childOffsets.length - 1];
        const childrenMid = (firstChildX + lastChildX) / 2;

        // 让子嗣群组中心完美对齐本家庭几何中心
        const alignOffset = familyCenter - childrenMid;

        childLayouts.forEach((childLayout, idx) => {
          const finalChildOffset = childOffsets[idx] + alignOffset;
          Object.entries(childLayout.positions).forEach(([id, relX]) => {
            subPositions[id] = relX + finalChildOffset;
          });

          // 合并轮廓 contour
          Object.entries(childLayout.contour).forEach(([yStr, bounds]) => {
            const y = Number(yStr);
            const left = bounds.left + finalChildOffset;
            const right = bounds.right + finalChildOffset;

            if (subContour[y]) {
              subContour[y].left = Math.min(subContour[y].left, left);
              subContour[y].right = Math.max(subContour[y].right, right);
            } else {
              subContour[y] = { left, right };
            }
          });
        });
      }

      return { positions: subPositions, contour: subContour };
    };

    // 5. 寻找树的最高辈分祖先根节点并执行布局计算
    const minHeight = Math.min(...layouted.map(n => generationLevels[n.id] ?? 0));
    const roots = layouted.filter(n => (generationLevels[n.id] ?? 0) === minHeight);
    const primaryRoots = roots.filter(n => isPrimaryNode(n.id));

    let currentRootOffset = 0;
    primaryRoots.forEach((root, idx) => {
      // 根节点 Y 轴默认定为首层代际级别（相对0）
      const rootLayout = layoutSubtree(root.id, 0);

      Object.entries(rootLayout.positions).forEach(([id, relX]) => {
        const node = nodeMap.get(id);
        if (node) {
          node.position.x = relX + currentRootOffset;
        }
      });

      // 如果有多个根节点，防止根节点子树发生碰撞
      if (idx < primaryRoots.length - 1) {
        let maxShift = 0;
        const nextRootLayout = layoutSubtree(primaryRoots[idx + 1].id, 0);
        const yLevels = Object.keys(rootLayout.contour).map(Number);
        const nextYLevels = Object.keys(nextRootLayout.contour).map(Number);

        yLevels.forEach(yPrev => {
          nextYLevels.forEach(yCurr => {
            if (Math.abs(yPrev - yCurr) < 150) {
              const shift = rootLayout.contour[yPrev].right + 120 - nextRootLayout.contour[yCurr].left;
              if (shift > maxShift) maxShift = shift;
            }
          });
        });
        currentRootOffset += maxShift > 0 ? maxShift : 500;
      }
    });

    // 根据配偶双方最终对齐完毕后的物理 X 轴坐标，动态分配连接点 Handles，确保配偶连线始终水平且不产生穿透
    graphEdges.forEach((edge) => {
      if (edge.id.startsWith('spouse-')) {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (sourceNode && targetNode) {
          if (sourceNode.position.x < targetNode.position.x) {
            // source (丈夫) 在左，target (妻子) 在右
            edge.sourceHandle = 'right-source';
            edge.targetHandle = 'left-target';
          } else {
            // source (丈夫) 在右，target (妻子) 在左
            edge.sourceHandle = 'left-source';
            edge.targetHandle = 'right-target';
          }
        }
      }
    });

    // ====== 新增：全局平移，将主视角人物的几何中心（即位置）对齐到原点 (0,0) ======
    const perspectiveNode = layouted.find(n => n.id === perspectiveId);
    if (perspectiveNode) {
      const deltaX = 0 - perspectiveNode.position.x;
      const deltaY = 0 - perspectiveNode.position.y;

      layouted.forEach((n) => {
        n.position.x += deltaX;
        n.position.y += deltaY;
      });
    }

    setNodes(layouted);
    // 渲染时把配偶边连线也一同展示给 React Flow，并默认让配偶连线在最上层
    const defaultSortedEdges = [...graphEdges].sort((a, b) => {
      const scoreA = a.id.startsWith('spouse-') ? 2 : 0;
      const scoreB = b.id.startsWith('spouse-') ? 2 : 0;
      return scoreA - scoreB;
    });
    setEdges(defaultSortedEdges);
  }, [project?.persons, project?.meta.defaultPerspectiveId, setNodes, setEdges]);

  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  useEffect(() => {
    if (project && !hasAppliedCustomLayoutRef.current) {
      if (project.customLayout && Object.keys(project.customLayout).length > 0) {
        applyCustomLayout();
      }
      hasAppliedCustomLayoutRef.current = true;
    }
  }, [project, applyCustomLayout]);

  // 右键菜单处理
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      personId: node.id,
    });
  }, []);

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 添加关系人物
  const handleAddRelation = (type: string) => {
    if (!contextMenu) return;
    const personId = contextMenu.personId;
    const person = persons.find((p) => p.id === personId);
    if (!person) return;

    let newId = '';

    switch (type) {
      case 'father':
        newId = addPerson({ gender: 'male' });
        if (!newId) return;
        setRelation(personId, 'father', newId);
        break;
      case 'mother':
        newId = addPerson({ gender: 'female' });
        if (!newId) return;
        setRelation(personId, 'mother', newId);
        break;
      case 'child':
        newId = addPerson();
        if (!newId) return;
        // 新人物的父/母设为当前人物，若当前人物已拥有配偶，则一并绑定配偶为另一半父母
        if (person.gender === 'male') {
          setRelation(newId, 'father', personId);
          const spouseId = person.relations.spouses?.[0]?.id;
          if (spouseId) {
            setRelation(newId, 'mother', spouseId);
          }
        } else {
          setRelation(newId, 'mother', personId);
          const spouseId = person.relations.spouses?.[0]?.id;
          if (spouseId) {
            setRelation(newId, 'father', spouseId);
          }
        }
        break;
      case 'spouse': {
        const spouseGender = person.gender === 'male' ? 'female' : 'male';
        newId = addPerson({ gender: spouseGender });
        if (!newId) return;
        const { addSpouse } = useFamilyStore.getState();
        addSpouse(personId, newId);
        break;
      }
    }

    setContextMenu(null);
    navigate(`/person/${newId}/edit`);
  };

  const handleDeletePerson = () => {
    if (!contextMenu) return;
    const personId = contextMenu.personId;
    const person = persons.find((p) => p.id === personId);
    if (!person) return;

    setContextMenu(null);
    setDialog({
      show: true,
      title: '删除确认',
      message: `确定要删除“${person.surname}${person.givenName || ''}”吗？此操作将移除其所有的代际与配偶关系，且不可恢复。`,
      onConfirm: () => {
        deletePerson(personId);
      },
    });
  };

  // 空状态
  if (persons.length === 0) {
    return (
      <div className="tree-page">
        <div className="tree-toolbar">
          <div className="tree-toolbar-left">
            <h3>家谱树</h3>
          </div>
          {currentFilePath && (
            <div className="tree-filepath-indicator" style={{
              fontSize: '12px',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'monospace',
              opacity: 0.7,
              marginLeft: 'auto',
              marginRight: '20px',
              maxWidth: '50%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }} title={currentFilePath}>
              📁 {currentFilePath}
            </div>
          )}
        </div>
        <div className="tree-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="tree-empty">
            <div className="tree-empty-icon">🌳</div>
            <div className="tree-empty-title">还没有添加人物</div>
            <div className="tree-empty-desc">添加第一个人物，开始构建你的家谱树</div>
            <button className="btn btn-primary" onClick={() => navigate('/person/new/edit')}>
              ＋ 添加第一个人物
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tree-page">
      <div className="tree-toolbar">
        <div className="tree-toolbar-left">
          <h3>家谱树</h3>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)' }}>
            共 {persons.length} 人
          </span>
        </div>
        {currentFilePath && (
          <div className="tree-filepath-indicator" style={{
            fontSize: '12px',
            color: 'var(--color-text-tertiary)',
            fontFamily: 'monospace',
            opacity: 0.7,
            marginLeft: 'auto',
            marginRight: '20px',
            maxWidth: '40%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }} title={currentFilePath}>
            📁 {currentFilePath}
          </div>
        )}
        <div className="tree-toolbar-right">
          <button
            className={`btn btn-sm ${showCoordinates ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
              boxShadow: showCoordinates ? '0 0 10px oklch(60% 0.16 250 / 0.3)' : 'none',
              transition: 'all 0.2s'
            }}
            onClick={() => setShowCoordinates(!showCoordinates)}
          >
            📐 {showCoordinates ? '隐藏坐标系' : '显示坐标系'}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => navigate('/person/new/edit')}>
            ➕ 添加人物
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => buildGraph()}>
            🔄 重置布局
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={applyCustomLayout}
            disabled={!hasCustomLayout}
            style={{
              opacity: hasCustomLayout ? 1 : 0.5,
              cursor: hasCustomLayout ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s',
            }}
            title="应用自定义拖拽后保存的卡片坐标布局"
          >
            🎨 自定义布局
          </button>
        </div>
      </div>

      <div className={`tree-container ${showCoordinates ? 'show-grid' : ''}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneClick={handlePaneClick}
          onNodeDragStop={handleNodeDragStop}
          ariaLabelConfig={{
            'controls.zoomIn.ariaLabel': '放大',
            'controls.zoomOut.ariaLabel': '缩小',
            'controls.fitView.ariaLabel': '适应窗口',
            'controls.interactive.ariaLabel': '锁定/解锁画布',
          }}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          snapToGrid={false}
          nodeOrigin={[0.5, 0.5]}
        >
          <Controls />
          <MiniMap
            nodeStrokeColor="oklch(80% 0.01 65)"
            nodeColor="oklch(95% 0.01 65)"
            nodeBorderRadius={8}
          />
          {showCoordinates && (
            <Background variant={BackgroundVariant.Lines} gap={50} size={1} color="rgba(0,0,0,0.06)" />
          )}
          {showCoordinates && <CoordinateAxes />}
        </ReactFlow>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setContextMenu(null)}
          />
          <div
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button className="context-menu-item" onClick={() => navigate(`/person/${contextMenu.personId}`)}>
              👤 查看详情
            </button>
            <button className="context-menu-item" onClick={() => navigate(`/person/${contextMenu.personId}/edit`)}>
              ✏️ 编辑信息
            </button>
            <div className="context-menu-divider" />
            <button className="context-menu-item" onClick={() => handleAddRelation('father')}>
              ➕ 添加父亲
            </button>
            <button className="context-menu-item" onClick={() => handleAddRelation('mother')}>
              ➕ 添加母亲
            </button>
            <button className="context-menu-item" onClick={() => handleAddRelation('spouse')}>
              ➕ 添加配偶
            </button>
            <button className="context-menu-item" onClick={() => handleAddRelation('child')}>
              ➕ 添加子女
            </button>
            <div className="context-menu-divider" />
            <button className="context-menu-item danger-text" onClick={handleDeletePerson}>
              🗑️ 删除人物
            </button>
          </div>
        </>
      )}

      {/* 自定义删除确认弹窗 */}
      {dialog && (
        <div className="custom-dialog-overlay" onClick={() => setDialog(null)}>
          <div className="custom-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <span className="custom-dialog-icon">⚠️</span>
              <span className="custom-dialog-title">{dialog.title}</span>
            </div>
            <div className="custom-dialog-message">{dialog.message}</div>
            <div className="custom-dialog-buttons">
              <button className="btn btn-secondary btn-sm" onClick={() => setDialog(null)}>
                取消
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  dialog.onConfirm();
                  setDialog(null);
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TreePage() {
  return (
    <ReactFlowProvider>
      <TreePageContent />
    </ReactFlowProvider>
  );
}
