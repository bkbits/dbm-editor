/**
 * 主键与审计字段约定：默认值、角色元信息与归一化工具
 * （「系统设置 → 主键与审计字段」编辑名称/类型与审计字段 Java 类型；表编辑对话框据此固定首字段
 *   与「添加审计字段 / 删除审计字段」一键增删）
 */
import type {
  AuditFieldConvention,
  AuditFieldRole,
  FieldConventions,
  LogicDeleteConvention,
  PrimaryKeyConvention,
} from "@/types/model";

/** 审计字段角色顺序（「添加审计字段」时的插入顺序） */
export const AUDIT_FIELD_ROLES: AuditFieldRole[] = [
  "createBy",
  "createTime",
  "updateBy",
  "updateTime",
];

/** 审计字段角色标签 */
export const AUDIT_FIELD_LABELS: Record<AuditFieldRole, string> = {
  createBy: "创建人",
  createTime: "创建时间",
  updateBy: "更新人",
  updateTime: "更新时间",
};

/** 审计字段非空约束（固定语义：创建人/创建时间强制非空，更新人/更新时间可空） */
export const AUDIT_FIELD_NOT_NULL: Record<AuditFieldRole, boolean> = {
  createBy: true,
  createTime: true,
  updateBy: false,
  updateTime: false,
};

/** 逻辑删除字段标签（设置页与表编辑共用） */
export const LOGIC_DELETE_FIELD_LABEL = "逻辑删除";

/**
 * 默认约定（需求规格：主键 id/BIGINT；审计字段蛇形命名 create_by 等，Java 属性名由小驼峰转换自动得到 createBy）。
 * 审计字段与逻辑删除字段 javaType 缺省（空 = 按列类型映射规则自动推导，建列时取推导值；显式设定则固定使用）
 */
export const DEFAULT_FIELD_CONVENTIONS: FieldConventions = {
  primaryKey: { name: "id", type: "BIGINT" },
  auditFields: {
    createBy: { name: "create_by", type: "BIGINT" },
    createTime: { name: "create_time", type: "DATETIME" },
    updateBy: { name: "update_by", type: "BIGINT" },
    updateTime: { name: "update_time", type: "DATETIME" },
  },
  logicDelete: { name: "deleted", type: "TINYINT" },
};

/** 归一化逻辑删除字段约定（旧数据缺省时按默认补齐） */
function normalizeLogicDelete(raw: unknown): LogicDeleteConvention {
  const r = ((raw || {}) as Partial<LogicDeleteConvention>) || {};
  const def = DEFAULT_FIELD_CONVENTIONS.logicDelete;
  return {
    name: String(r.name ?? def.name).trim() || def.name,
    type: String(r.type ?? def.type).trim() || def.type,
    javaType: String(r.javaType ?? "").trim() || undefined,
  };
}

/**
 * 归一化（旧数据/外部数据缺省时按默认补齐；名称/类型去空白，空值回退默认）。
 * 非空约束不在数据内（随角色的固定语义），由 AUDIT_FIELD_NOT_NULL 提供；
 * javaType 去空白后为空串时归一为 undefined（语义：按类型映射规则自动推导）
 */
export function normalizeFieldConventions(raw: unknown): FieldConventions {
  const s = (raw || {}) as {
    primaryKey?: Partial<PrimaryKeyConvention>;
    auditFields?: Partial<Record<AuditFieldRole, Partial<AuditFieldConvention>>>;
    logicDelete?: Partial<LogicDeleteConvention>;
  };
  const def = DEFAULT_FIELD_CONVENTIONS;
  const auditFields = {} as FieldConventions["auditFields"];
  for (const role of AUDIT_FIELD_ROLES) {
    const r = s.auditFields?.[role] || {};
    auditFields[role] = {
      name: String(r.name ?? def.auditFields[role].name).trim() || def.auditFields[role].name,
      type: String(r.type ?? def.auditFields[role].type).trim() || def.auditFields[role].type,
      javaType: String(r.javaType ?? "").trim() || undefined,
    };
  }
  return {
    primaryKey: {
      name: String(s.primaryKey?.name ?? def.primaryKey.name).trim() || def.primaryKey.name,
      type: String(s.primaryKey?.type ?? def.primaryKey.type).trim() || def.primaryKey.type,
    },
    auditFields,
    logicDelete: normalizeLogicDelete(s.logicDelete),
  };
}

/** 全部约定字段名（主键在前，审计按角色顺序，逻辑删除末尾；校验/展示用） */
export function conventionNames(fc: FieldConventions): string[] {
  return [
    fc.primaryKey.name,
    ...AUDIT_FIELD_ROLES.map((role) => fc.auditFields[role].name),
    fc.logicDelete.name,
  ];
}
