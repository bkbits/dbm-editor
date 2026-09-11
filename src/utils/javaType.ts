/**
 * 数据库类型 -> Java 类型映射
 */
import type { TableColumn } from '@/types/model'

const JAVA_TYPE_MAP: Record<string, string> = {
  varchar: 'String',
  char: 'String',
  text: 'String',
  tinytext: 'String',
  mediumtext: 'String',
  longtext: 'String',
  json: 'String',
  enum: 'String',
  set: 'String',
  int: 'Integer',
  integer: 'Integer',
  smallint: 'Integer',
  tinyint: 'Integer',
  mediumint: 'Integer',
  bigint: 'Long',
  decimal: 'BigDecimal',
  numeric: 'BigDecimal',
  float: 'Float',
  double: 'Double',
  real: 'Double',
  date: 'LocalDate',
  datetime: 'LocalDateTime',
  timestamp: 'LocalDateTime',
  time: 'LocalTime',
  year: 'Integer',
  boolean: 'Boolean',
  bool: 'Boolean',
  bit: 'Boolean',
  blob: 'byte[]',
  tinyblob: 'byte[]',
  mediumblob: 'byte[]',
  longblob: 'byte[]',
  binary: 'byte[]',
  varbinary: 'byte[]',
}

/** 常见数据库类型（编辑器候选项） */
export const COMMON_DB_TYPES = [
  'VARCHAR(32)',
  'VARCHAR(50)',
  'VARCHAR(64)',
  'VARCHAR(100)',
  'VARCHAR(255)',
  'CHAR(1)',
  'TEXT',
  'LONGTEXT',
  'JSON',
  'INT',
  'INT UNSIGNED',
  'TINYINT',
  'TINYINT(1)',
  'SMALLINT',
  'BIGINT',
  'BIGINT UNSIGNED',
  'DECIMAL(10,2)',
  'DECIMAL(20,2)',
  'FLOAT',
  'DOUBLE',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
]

/** 常见 Java 类型（编辑器候选项） */
export const COMMON_JAVA_TYPES = [
  'String',
  'Integer',
  'Long',
  'Double',
  'Float',
  'Boolean',
  'BigDecimal',
  'LocalDate',
  'LocalDateTime',
  'LocalTime',
  'byte[]',
  'Object',
]

/** 根据数据库类型推导 Java 类型（不带列上下文） */
export function getJavaTypeByType(dbType: string | null | undefined): string {
  const raw = String(dbType ?? '')
    .toLowerCase()
    .trim()
  if (!raw) return 'String'
  const base = raw
    .replace(/\(.*\)/, '')
    .replace(/\s+unsigned.*/, '')
    .trim()
  if (base === 'tinyint' && /\(1\)/.test(raw)) return 'Boolean'
  return JAVA_TYPE_MAP[base] ?? 'String'
}

/**
 * 根据列信息获取 Java 类型：
 * 优先使用显式配置的 javaType，否则依据数据库类型推导
 */
export function getJavaType(column: Pick<TableColumn, 'type' | 'javaType'>): string {
  if (column.javaType && String(column.javaType).trim()) return String(column.javaType).trim()
  return getJavaTypeByType(column.type)
}
