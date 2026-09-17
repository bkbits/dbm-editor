/**
 * 种子数据 · 模板（表模板 + 字典分类模板）
 *
 * 从原 mock/seed.ts 单文件按域拆出：四张表模板（Entity / Mapper /
 * Service / Controller，Eta 语法）与唯一的字典分类模板。
 * 模板内容为长字符串（内嵌 Vue SFC 演示片段等），保持原样未改写。
 */
import type { CodeTemplate } from "@/types/model";

/* ============ 模板 ============ */
/** 表模板清单（Eta 语法；含 Entity/Mapper/Service/Controller 等） */
export const SEED_TEMPLATES: CodeTemplate[] = [
  {
    id: "tpl-entity",
    name: "entity",
    content: `<%
  context.fileName = context.table.className + ".java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "entity/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const propOf = (colName, vo) => {
    const cols = vo ? vo.columns : context.table.columns;
    const col = cols.find((c) => c.columnName === colName);
    return (col && col.propertyName) || utils.toCamelCase(colName, true);
  };
  const fieldsRef = (colNames, vo) => colNames.map((p) => (vo ? vo.className + ".Fields." : "Fields.") + propOf(p, vo)).join(", ");
  const fieldsArg = (colNames, vo) => { const s = fieldsRef(colNames, vo); return s.includes(",") ? "{ " + s + " }" : s; };
  const relEnum = { "11": "OneToOne", "1N": "OneToMany", "N1": "ManyToOne", "NN": "ManyToMany" };
  const tableDirect = utils.toSnakeCase(cls) === context.table.tableName;
  const propDirect = (column) => utils.toSnakeCase(column.propertyName || utils.toCamelCase(column.columnName, true)) === column.columnName;
  const needColumnAnno = context.table.columns.some((c) => c.primaryKey || !propDirect(c));
  const parentCol = context.table.parentIdColumn ? context.getColumn(context.table.parentIdColumn) : null;
  const hasNav = context.table.navigates.length > 0 || !!parentCol;
  const needList = hasNav && (context.table.navigates.some((n) => n.type === "1N" || n.type === "NN") || !!parentCol);
  const ifaces = [];
  if (context.hasColumn("create_time") && context.hasColumn("create_by")) ifaces.push("ICreate");
  if (context.hasColumn("update_time") && context.hasColumn("update_by")) ifaces.push("IUpdate");
  if (context.hasColumn("id")) ifaces.push("IGenId");
  if (context.hasColumn("dept_id")) ifaces.push("IDeptId");
  const dateTypes = [...new Set(context.table.columns.map(c => utils.getJavaType(c)).filter(t => /^Local(Date|Time|DateTime)$/.test(t)))];
  const needDecimal = context.table.columns.some(c => utils.getJavaType(c) === "BigDecimal");
%>
package <%= pkg %>entity;

<% if (needColumnAnno) { %>import com.easy.query.core.annotation.Column;
<% } %>import com.easy.query.core.annotation.EntityProxy;
<% if (hasNav) { %>import com.easy.query.core.annotation.Navigate;
<% } %>import com.easy.query.core.annotation.Table;
<% if (hasNav) { %>import com.easy.query.core.enums.RelationTypeEnum;
<% } %>import com.easy.query.core.proxy.ProxyEntityAvailable;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import lombok.experimental.FieldNameConstants;
import <%= pkg %>entity.proxy.<%= cls %>Proxy;
import java.io.Serializable;
<% if (needDecimal) { %>import java.math.BigDecimal;
<% } %><% for (const dt of dateTypes) { %>import java.time.<%= dt %>;
<% } %>
<% if (needList) { %>import java.util.List;
<% } %>
<%# ===== easy-query 实体：@Table 常驻（命名直转省略参数）、@EntityProxy 触发代理生成、swagger2 注解、审计接口按列自动实现 ===== %>
/**
 * <%= comment %>
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Data
@FieldNameConstants
<% if (tableDirect) { %>@Table
<% } else { %>@Table("<%= context.table.tableName %>")
<% } %>@EntityProxy
@ApiModel("<%= comment %>")
public class <%= cls %> implements Serializable, ProxyEntityAvailable<<%= cls %>, <%= cls %>Proxy><% for (const i of ifaces) { %>, <%= i %><% } %> {

  private static final long serialVersionUID = 1L;
<% for (const column of context.table.columns) {
  const prop = column.propertyName || utils.toCamelCase(column.columnName, true);
  const anno = column.primaryKey
    ? (propDirect(column) ? "@Column(primaryKey = true)" : '@Column(value = "' + column.columnName + '", primaryKey = true)')
    : (propDirect(column) ? "" : '@Column("' + column.columnName + '")');
  const doc = column.comment || (column.primaryKey ? "主键" : "");
  const mark = column.primaryKey && doc.indexOf("主键") < 0 ? "（主键）" : "";
  const apiDoc = doc + mark || prop;
%>
<% if (doc) { %>  /** <%= doc + mark %> */
<% } %>  @ApiModelProperty("<%= apiDoc %>")
<% if (anno) { %>  <%= anno %>
<% } %>  private <%= utils.getJavaType(column) %> <%= prop %>;
<% } %>
<% if (parentCol) {
  const parentProp = parentCol.propertyName || utils.toCamelCase(parentCol.columnName, true);
%>
  /* ---- 树形导航（<%= parentCol.columnName %> 自关联） ---- */
  @ApiModelProperty("父节点")
  @Navigate(value = RelationTypeEnum.ManyToOne, selfProperty = Fields.<%= parentProp %>, targetProperty = Fields.id)
  private <%= cls %> parent;

  @ApiModelProperty("子节点")
  @Navigate(value = RelationTypeEnum.OneToMany, selfProperty = Fields.id, targetProperty = Fields.<%= parentProp %>)
  private List<<%= cls %>> children;
<% } %>
<% if (context.table.navigates.length) { %>
  /* ---- 导航关系（easy-query @Navigate） ---- */
<% for (const nav of context.table.navigates) {
    const target = nav.target.className;
    const isMany = nav.type === "1N" || nav.type === "NN";
    const navDoc = nav.comment || nav.propertyName;
%>
  /** 导航(<%= nav.type %>): <%= nav.selfProperty.join(", ") %> -> <%= nav.target.tableName %>.<%= nav.targetProperty.join(", ") %> */
  @ApiModelProperty("<%= navDoc %>")
<% if (nav.type === "NN") { %>  @Navigate(
      value = RelationTypeEnum.ManyToMany,
      mappingClass = <%= nav.mappingTable.className %>.class,
      selfProperty = <%= fieldsArg(nav.selfProperty, null) %>,
      selfMappingProperty = <%= fieldsArg(nav.selfMappingProperty, nav.mappingTable) %>,
      targetMappingProperty = <%= fieldsArg(nav.targetMappingProperty, nav.mappingTable) %>,
      targetProperty = <%= fieldsArg(nav.targetProperty, nav.target) %>
  )
  private List<<%= target %>> <%= nav.propertyName %>;
<% } else { %>  @Navigate(value = RelationTypeEnum.<%= relEnum[nav.type] %>, selfProperty = <%= fieldsArg(nav.selfProperty, null) %>, targetProperty = <%= fieldsArg(nav.targetProperty, nav.target) %>)
  private <%= isMany ? "List<" + target + ">" : target %> <%= nav.propertyName %>;
<% } %>
<% } %>
<% } %>
}
`,
  },
  {
    id: "tpl-mapper",
    name: "mapper",
    content: `<%
  context.fileName = context.table.className + "Mapper.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "mapper/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  if (!addOn && !updOn) {
    context.aborted = true;
    return "";
  }
%>
package <%= pkg %>mapper;

import org.mapstruct.Mapper;
import org.mapstruct.factory.Mappers;
<% if (addOn) { %>import <%= pkg %>dto.<%= cls %>AddDTO;
<% } %><% if (updOn) { %>import <%= pkg %>dto.<%= cls %>UpdateDTO;
<% } %>import <%= pkg %>entity.<%= cls %>;

<%# ===== MapStruct 对象转换器：静态单例 INSTANCE，方法按表选项（add/update）选择性生成；两者皆关时整模板丢弃 ===== %>
/**
 * <%= comment %> MapStruct 对象转换器
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Mapper
public interface <%= cls %>Mapper {

  /**
   * 转换器单例（MapStruct 编译期生成实现类，静态单例方式初始化）
   */
  <%= cls %>Mapper INSTANCE = Mappers.getMapper(<%= cls %>Mapper.class);
<% if (addOn) { %>
  /**
   * <%= cls %>AddDTO 转换为 <%= cls %> 实体
   *
   * @param dto 新增参数对象
   * @return 转换后的实体
   */
  <%= cls %> toEntity(<%= cls %>AddDTO dto);
<% } %>
<% if (updOn) { %>
  /**
   * <%= cls %>UpdateDTO 转换为 <%= cls %> 实体
   *
   * @param dto 更新参数对象
   * @return 转换后的实体
   */
  <%= cls %> toEntity(<%= cls %>UpdateDTO dto);
<% } %>
}
`,
  },
  {
    id: "tpl-service",
    name: "service",
    content: `<%
  context.fileName = context.table.className + "Service.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "service/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  if (!addOn && !updOn && !rmOn) {
    context.aborted = true;
    return "";
  }
%>
package <%= pkg %>service;

import org.jetbrains.annotations.NotNull;
<% if (queryOn) { %>import org.jetbrains.annotations.Nullable;
<% } %>
<% if (rmOn) { %>import java.util.List;
<% } %>
import <%= pkg %>entity.<%= cls %>;

<%# ===== 服务接口：方法按表选项选择性生成；add/update/remove 全关时整模板丢弃 ===== %>
/**
 * <%= comment %> 服务接口
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
public interface <%= cls %>Service {
<% if (queryOn) { %>
  /**
   * 按主键查询实体
   *
   * @param id 主键
   * @return 实体对象；查询不到时返回 null
   */
  @Nullable
  <%= cls %> getById(Long id);
<% } %>
<% if (addOn) { %>
  /**
   * 新增实体
   *
   * @param entity 实体对象
   */
  void add(@NotNull <%= cls %> entity);
<% } %>
<% if (updOn) { %>
  /**
   * 按主键整实体更新
   *
   * @param entity 实体对象
   */
  void update(@NotNull <%= cls %> entity);
<% } %>
<% if (rmOn) { %>
  /**
   * 按主键删除
   *
   * @param id 主键
   */
  void remove(@NotNull Long id);

  /**
   * 按主键批量删除
   *
   * @param ids 主键集合
   */
  void batchRemove(@NotNull List<Long> ids);
<% } %>
}
`,
  },
  {
    id: "tpl-service-impl",
    name: "serviceImpl",
    content: `<%
  context.fileName = context.table.className + "ServiceImpl.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "service/impl/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  if (!addOn && !updOn && !rmOn) {
    context.aborted = true;
    return "";
  }
%>
package <%= pkg %>service.impl;

import com.easy.query.core.api.EasyQuery;
import org.jetbrains.annotations.NotNull;
<% if (queryOn) { %>import org.jetbrains.annotations.Nullable;
<% } %>import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
<% if (rmOn) { %>import java.util.List;
<% } %>
import <%= pkg %>entity.<%= cls %>;
import <%= pkg %>service.<%= cls %>Service;

<%# ===== 服务实现：solon3 容器组件 + easy-query 门面注入；方法与 service 接口按表选项联动 ===== %>
/**
 * <%= comment %> 服务实现
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Component
public class <%= cls %>ServiceImpl implements <%= cls %>Service {

  @Inject
  EasyQuery easyQuery;
<% if (queryOn) { %>
  /**
   * 按主键查询实体
   *
   * @param id 主键
   * @return 实体对象；查询不到时返回 null
   */
  @Override
  @Nullable
  public <%= cls %> getById(Long id) {
    return easyQuery.queryable(<%= cls %>.class).whereId(id).firstOrNull();
  }
<% } %>
<% if (addOn) { %>
  /**
   * 新增实体
   *
   * @param entity 实体对象
   */
  @Override
  public void add(@NotNull <%= cls %> entity) {
    easyQuery.insertable(entity).executeRows();
  }
<% } %>
<% if (updOn) { %>
  /**
   * 按主键整实体更新
   *
   * @param entity 实体对象
   */
  @Override
  public void update(@NotNull <%= cls %> entity) {
    easyQuery.updatable(entity).executeRows();
  }
<% } %>
<% if (rmOn) { %>
  /**
   * 按主键删除
   *
   * @param id 主键
   */
  @Override
  public void remove(@NotNull Long id) {
    easyQuery.deletable(<%= cls %>.class).whereId(id).executeRows();
  }

  /**
   * 按主键批量删除
   *
   * @param ids 主键集合
   */
  @Override
  public void batchRemove(@NotNull List<Long> ids) {
    easyQuery.deletable(<%= cls %>.class).whereByIds(ids).executeRows();
  }
<% } %>
}
`,
  },
  {
    id: "tpl-controller",
    name: "controller",
    content: `<%
  context.fileName = context.table.className + "Controller.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "controller/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const mod = utils.toCamelCase(cls, true);
  const route = mod.replace(/([A-Z])/g, "-$1").toLowerCase();
  // 路径与权限码风格：表名按首下划线拆为「模块/功能」——sys_user → sys/user；
  // 无下划线时模块与功能同段（如 article → article）
  const nameParts = String(context.table.tableName).split("_").filter(Boolean);
  const module = (nameParts[0] || route).toLowerCase();
  const func = (nameParts.length > 1 ? nameParts.slice(1).join("_") : module).toLowerCase();
  // 权限码前缀：模块.功能（操作在后，如 sys.user.add）
  const perms = module + "." + func;
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  if (!queryOn && !addOn && !updOn && !rmOn) {
    context.aborted = true;
    return "";
  }
  // service 可用性：add/update/remove 全关时 service 模板被丢弃（无法注入），
  // 此时 info 直接经 easyEntityQuery 查询，避免悬空引用
  const svcAvailable = addOn || updOn || rmOn;
  const propOfCol = (column) => column.propertyName || utils.toCamelCase(column.columnName, true);
  const queryCols = queryOn
    ? context.table.columns.filter((c) => !c.primaryKey && utils.optionEnabled(c.options, "query"))
    : [];
  const isStrType = (jt) => jt === "String" || jt === "Character";
  // 时间类型（查询条件默认 rangeClosed 闭区间，拆起止双参数）
  const isTimeType = (jt) => /^(LocalDate|LocalDateTime|LocalTime|Timestamp)$/.test(jt);
  // id 类（外键 _id 结尾）或关联字典的列：eq 精准匹配（主键已被 queryCols 排除）
  const isIdOrDict = (c) => /_id$/.test(String(c.columnName)) || !utils.isBlank(c.dict);
  // 查询参数声明：时间列拆 <prop>Begin/<prop>End 双参数，其余单参数
  const paramDecls = [];
  for (const c of queryCols) {
    const p = propOfCol(c);
    const jt = utils.getJavaType(c);
    if (isTimeType(jt)) {
      paramDecls.push("@Param(value = \\"Begin" + p + "\\"Begin");
      paramDecls.push("@Param(value = \\"End" + p + "\\"End");
    } else {
      paramDecls.push("@Param(value = \\"" + p + "\\"");
    }
  }
  const listSignature = paramDecls.length === 0
    ? "public List<" + cls + "> list() {"
    : paramDecls.length === 1
      ? "public List<" + cls + "> list(" + paramDecls[0] + ") {"
      : "public List<" + cls + "> list(\\n            " + paramDecls.join(",\\n            ") + ") {";
  // 查询条件构建：时间 → rangeClosed（起止双参数）；id/字典 → eq；字符串 → like；其余数值 → eq
  const condLine = (c) => {
    const p = propOfCol(c);
    const jt = utils.getJavaType(c);
    if (isTimeType(jt)) {
      return "o." + p + "().rangeClosed(" + p + "Begin != null && " + p + "End != null, " + p + "Begin, " + p + "End);";
    }
    if (isIdOrDict(c)) {
      return "o." + p + "().eq(" + p + " != null, " + p + ");";
    }
    if (isStrType(jt)) {
      return "o." + p + "().like(" + p + " != null && !" + p + ".isEmpty(), " + p + ");";
    }
    return "o." + p + "().eq(" + p + " != null, " + p + ");";
  };
  // javadoc @param 行：时间列起止双参数，其余单参数
  const docParams = [];
  for (const c of queryCols) {
    const p = propOfCol(c);
    const jt = utils.getJavaType(c);
    if (isTimeType(jt)) {
      docParams.push({ p: p + "Begin", d: (c.comment || p) + "起始（可选）" });
      docParams.push({ p: p + "End", d: (c.comment || p) + "截止（可选，与起始构成闭区间）" });
    } else {
      docParams.push({ p, d: (c.comment || p) + "（可选）" });
    }
  }
%>
package <%= pkg %>controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
<% if (queryOn) { %>import com.easy.query.api.proxy.client.EasyEntityQuery;
<% } %>import org.noear.solon.annotation.Controller;
<% if (addOn || updOn) { %>import org.noear.solon.annotation.Body;
<% } %><% if (queryOn) { %>import org.noear.solon.annotation.Get;
<% } %><% if (addOn || updOn || rmOn) { %>import org.noear.solon.annotation.Post;
<% } %><% if (queryOn || rmOn) { %>import org.noear.solon.annotation.Param;
<% } %>import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
<% if (queryOn) { %>import java.util.List;
<% } %>
import <%= pkg %>entity.<%= cls %>;
<% if (svcAvailable) { %>import <%= pkg %>service.<%= cls %>Service;
<% } %>

<%# ===== 接口层（solon3 MVC + satoken 注解鉴权）：路径 /api/模块/功能/操作、权限码 模块.功能.操作；端点按表选项生成，查询条件按列选项（时间 rangeClosed / id 与字典 eq / 字符串 like） ===== %>
/**
 * <%= comment %> 管理接口
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Controller
@Mapping("/api/<%= module %>/<%= func %>")
public class <%= cls %>Controller {

<% if (svcAvailable) { %>  @Inject
  <%= cls %>Service <%= mod %>Service;
<% } %><% if (queryOn) { %>
  @Inject
  EasyEntityQuery easyEntityQuery;
<% } %>
<% if (queryOn) { %>
  /**
   * 按主键查询详情
   *
   * @param id 主键
   * @return 实体详情；不存在时为 null
   */
  @SaCheckPermission("<%= perms %>.info")
  @Get
  @Mapping("info")
  public <%= cls %> info(@Param("id") Long id) {
<% if (svcAvailable) { %>    return <%= mod %>Service.getById(id);
<% } else { %>    return easyEntityQuery.queryable(<%= cls %>.class).whereId(id).firstOrNull();
<% } %>  }

  /**
   * 查询列表<% if (queryCols.length) { %>（支持可选条件过滤：时间区间闭合匹配、id 与字典精准匹配、字符串模糊匹配）<% } %>
   *
<% for (const dp of docParams) { %>   * @param <%= dp.p %> <%= dp.d %>
<% } %>   * @return 实体列表
   */
  @SaCheckPermission("<%= perms %>.list")
  @Get
  @Mapping("list")
  <%= listSignature %>
<% if (queryCols.length) { %>    return easyEntityQuery.queryable(<%= cls %>.class)
        .where(o -> {
<% for (const c of queryCols) { %>          <%= condLine(c) %>
<% } %>        })
        .toList();
<% } else { %>    return easyEntityQuery.queryable(<%= cls %>.class).toList();
<% } %>  }
<% } %>
<% if (addOn) { %>
  /**
   * 新增实体
   *
   * @param entity 实体对象
   */
  @SaCheckPermission("<%= perms %>.add")
  @Post
  @Mapping("add")
  public void add(@Body <%= cls %> entity) {
    <%= mod %>Service.add(entity);
  }
<% } %>
<% if (updOn) { %>
  /**
   * 按主键整实体更新
   *
   * @param entity 实体对象
   */
  @SaCheckPermission("<%= perms %>.edit")
  @Post
  @Mapping("edit")
  public void edit(@Body <%= cls %> entity) {
    <%= mod %>Service.update(entity);
  }
<% } %>
<% if (rmOn) { %>
  /**
   * 按主键删除
   *
   * @param id 主键
   */
  @SaCheckPermission("<%= perms %>.del")
  @Post
  @Mapping("del")
  public void del(@Param("id") Long id) {
    <%= mod %>Service.remove(id);
  }

  /**
   * 按主键批量删除
   *
   * @param ids 主键集合
   */
  @SaCheckPermission("<%= perms %>.del")
  @Post
  @Mapping("batchDel")
  public void batchDel(@Param("ids") List<Long> ids) {
    <%= mod %>Service.batchRemove(ids);
  }
<% } %>
}
`,
  },
  {
    id: "tpl-vue",
    name: "vue",
    content: `<%
  context.fileName = context.table.className + ".vue";
  context.filePath = "views/" + utils.toCamelCase(context.table.className, true).replace(/([A-Z])/g, "-$1").toLowerCase() + "/" + context.fileName;
  context.language = "javascript";
  const cls = context.table.className;
  const pk = context.table.columns.find(c => c.primaryKey);
  const pkProp = pk ? (pk.propertyName || utils.toCamelCase(pk.columnName, true)) : "id";
  const mod = utils.toCamelCase(cls, true);
  const route = mod.replace(/([A-Z])/g, "-$1").toLowerCase();
  // 接口前缀与 Controller 模板对齐：/api/模块/功能（表名按首下划线拆分）
  const nameParts = String(context.table.tableName).split("_").filter(Boolean);
  const module = (nameParts[0] || route).toLowerCase();
  const func = (nameParts.length > 1 ? nameParts.slice(1).join("_") : module).toLowerCase();
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  const colShow = (column) => utils.optionEnabled(column.options, "show");
  const colForm = (column) => utils.optionEnabled(column.options, "add") || utils.optionEnabled(column.options, "update");
  const numTypes = ["Long", "Integer", "Short", "Double", "Float", "BigDecimal"];
  const tsType = (jt) => numTypes.includes(jt) ? "number" : "string";
  const defaultValue = (jt) => numTypes.includes(jt) ? "0" : "\\\\'\\\\'";
%>
<template>
  <div class="page">
    <a-card>
      <div class="table-toolbar">
        <a-space>
<% if (addOn) { %>          <a-button type="primary" @click="openCreate">新增</a-button>
<% } %>          <a-button :loading="loading" @click="fetchList">刷新</a-button>
        </a-space>
      </div>
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="pagination"
        row-key="<%= pkProp %>"
      >
<% if (updOn || rmOn) { %>        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-space>
<% if (updOn) { %>              <a-button size="small" @click="openEdit(record as <%= cls %>)">编辑</a-button>
<% } %><% if (rmOn) { %>              <a-popconfirm title="确定删除该记录？" @confirm="handleRemove(record as <%= cls %>)">
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
<% } %>            </a-space>
          </template>
        </template>
<% } %>      </a-table>
    </a-card>

    <a-modal
      v-model:open="modalOpen"
      :title="isEdit ? '编辑' : '新增'"
      :confirm-loading="saving"
      @ok="handleSave"
    >
      <a-form :model="form" layout="vertical">
<% for (const column of context.table.columns) { %>
<% if (column.primaryKey || !colForm(column)) { continue; } %>
<% const jt = utils.getJavaType(column); %>
<% const label = column.comment || column.propertyName; %>
<% const isNum = numTypes.includes(jt); %>
<% const isDate = /^Local(Date|Time|DateTime)$/.test(jt); %>
<% const dfmt = jt === "LocalDateTime" ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD"; %>
<% const isText = /text/i.test(column.type); %>
        <a-form-item label="<%= label %>" name="<%= column.propertyName %>">
<% if (isNum) { %>          <a-input-number v-model:value="form.<%= column.propertyName %>" style="width: 100%" />
<% } else if (isDate) { %>          <a-date-picker v-model:value="form.<%= column.propertyName %>" value-format="<%= dfmt %>" style="width: 100%" />
<% } else if (isText) { %>          <a-textarea v-model:value="form.<%= column.propertyName %>" :rows="3" />
<% } else { %>          <a-input v-model:value="form.<%= column.propertyName %>" allow-clear />
<% } %>        </a-form-item>
<% } %>      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { message } from 'antdv-next'
import type { TableColumnsType } from 'antdv-next'

/**
 * <%= context.table.comment || context.table.tableName %> 实体（字段与后端 easy-query Entity 对齐）
 */
interface <%= cls %> {
<% for (const column of context.table.columns) { %>  /** <%= column.comment || column.propertyName %> */
  <%= column.propertyName %>: <%= tsType(utils.getJavaType(column)) %>
<% } %>}

/** 后端接口前缀（solon Controller @Mapping） */
const API_BASE = '/api/<%= module %>/<%= func %>'

const loading = ref(false)
const saving = ref(false)
const list = ref<<%= cls %>[]>([])
const modalOpen = ref(false)
const isEdit = ref(false)
const form = reactive<<%= cls %>>(emptyForm())

const pagination = { pageSize: 10, showSizeChanger: true }

const columns: TableColumnsType = [
<% for (const column of context.table.columns) { %>
<% if (!colShow(column)) { continue; } %>  { title: '<%= column.comment || column.propertyName %>', dataIndex: '<%= column.propertyName %>' },
<% } %><% if (updOn || rmOn) { %>  { title: '操作', key: 'action', width: 140 },
<% } %>]

function emptyForm(): <%= cls %> {
  return {
<% for (const column of context.table.columns) { %>    <%= column.propertyName %>: <%= defaultValue(utils.getJavaType(column)) %>,
<% } %>  }
}

async function fetchList() {
  loading.value = true
  try {
    const res = await fetch(\`\${API_BASE}/list\`)
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
    list.value = (await res.json()) as <%= cls %>[]
  } catch (e) {
    message.error(\`加载列表失败: \${(e as Error).message}\`)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isEdit.value = false
  Object.assign(form, emptyForm())
  modalOpen.value = true
}

function openEdit(record: <%= cls %>) {
  isEdit.value = true
  Object.assign(form, record)
  modalOpen.value = true
}

async function handleSave() {
  saving.value = true
  try {
    const action = isEdit.value ? 'edit' : 'add'
    const res = await fetch(\`\${API_BASE}/\${action}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
    message.success(isEdit.value ? '保存成功' : '新增成功')
    modalOpen.value = false
    await fetchList()
  } catch (e) {
    message.error(\`保存失败: \${(e as Error).message}\`)
  } finally {
    saving.value = false
  }
}

async function handleRemove(record: <%= cls %>) {
  try {
    const res = await fetch(\`\${API_BASE}/del?id=\${record.<%= pkProp %>}\`, { method: 'POST' })
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
    message.success('删除成功')
    await fetchList()
  } catch (e) {
    message.error(\`删除失败: \${(e as Error).message}\`)
  }
}

onMounted(fetchList)
</script>

<style scoped>
.table-toolbar {
  margin-bottom: 16px;
}
</style>
`,
  },
  {
    id: "tpl-sql",
    name: "sql",
    content: `<%
  context.fileName = context.table.tableName + ".sql";
  context.filePath = "sql/" + context.fileName;
%>
<% const pks = context.table.columns.filter(c => c.primaryKey); %>
<% const singleIntPk = pks.length === 1 && /^(tinyint|smallint|mediumint|int|integer|bigint)/i.test(pks[0].type); %>
<% const keyType = (t) => t === "UNIQUE" ? "UNIQUE KEY" : (t === "FULLTEXT" ? "FULLTEXT INDEX" : "KEY"); %>
<% const sq = (s) => "'" + String(s).split("'").join("''") + "'"; %>
<% const tail = []; %>
<% if (pks.length) { tail.push("  PRIMARY KEY (" + pks.map(c => "\`" + c.columnName + "\`").join(", ") + ")"); } %>
<% for (const idx of context.table.indexes) { %>
<% const idxBody = "  " + keyType(idx.type) + " \`" + idx.indexName + "\` (" + idx.columns.map(c => "\`" + c + "\`").join(", ") + ")" + (utils.isBlank(idx.comment) ? "" : " COMMENT " + sq(idx.comment)); %>
<% tail.push(idxBody); %>
<% } %>
<% const total = context.table.columns.length + tail.length; %>
<%# ===== MySQL 建表语句（utf8mb4 + 索引与主键随表结构生成） ===== %>
DROP TABLE IF EXISTS \`<%= context.table.tableName %>\`;
CREATE TABLE \`<%= context.table.tableName %>\` (
<% for (let i = 0; i < context.table.columns.length; i++) { %>
<% const column = context.table.columns[i]; %>
  \`<%= column.columnName %>\` <%= column.type %><% if (column.notNull) { %> NOT NULL<% } else { %> NULL<% } %><% if (column.primaryKey && singleIntPk) { %> AUTO_INCREMENT<% } %><% if (!utils.isBlank(column.comment)) { %> COMMENT <%= sq(column.comment) %><% } %><% if (i < total - 1) { %>,<% } %>
<% } %>
<% for (let j = 0; j < tail.length; j++) { %>
<%= tail[j] %><% if (j < tail.length - 1) { %>,<% } %>
<% } %>
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci COMMENT = <%= sq(context.table.comment || context.table.tableName) %>;`,
  },
  {
    id: "tpl-menu-sql",
    name: "menuSql",
    content: `<%
  context.fileName = context.table.tableName + "_menu.sql";
  context.filePath = "sql/" + context.fileName;
  const mod = utils.toCamelCase(context.table.className, true);
  const route = mod.replace(/([A-Z])/g, "-$1").toLowerCase();
  // 权限码与 Controller 模板一一对应：模块.功能.操作（表名按首下划线拆分）
  const nameParts = String(context.table.tableName).split("_").filter(Boolean);
  const module = (nameParts[0] || route).toLowerCase();
  const func = (nameParts.length > 1 ? nameParts.slice(1).join("_") : module).toLowerCase();
  const perms = module + "." + func;
  const sq = (s) => "'" + String(s).split("'").join("''") + "'";
  const menuName = context.table.comment || context.table.className;
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  const btns = [];
  if (queryOn) btns.push({ name: "查询", perms: perms + ".info" });
  if (queryOn) btns.push({ name: "列表", perms: perms + ".list" });
  if (addOn) btns.push({ name: "新增", perms: perms + ".add" });
  if (updOn) btns.push({ name: "编辑", perms: perms + ".edit" });
  if (rmOn) btns.push({ name: "删除", perms: perms + ".del" });
%>
<%# ===== MySQL 菜单与按钮权限初始化（sys_menu 为常见 RBAC 结构；按钮权限与 Controller 模板 @SaCheckPermission 按表选项一一对应） ===== %>
-- 一级菜单（parent_id = 0 为根目录，挂载位置按实际系统调整）
INSERT INTO sys_menu (menu_name, parent_id, order_num, path, component, menu_type, visible, status, perms, icon, create_time)
VALUES (<%= sq(menuName) %>, 0, 1, '<%= route %>', 'views/<%= route %>/<%= context.table.className %>', 'C', '0', '0', '<%= perms %>.list', 'list', NOW());
<% if (btns.length) { %>
-- 按钮权限（父菜单取上面新插入的记录；权限码与 Controller 模板的 @SaCheckPermission 一一对应，按表选项选择性生成）
SET @menuId = LAST_INSERT_ID();
INSERT INTO sys_menu (menu_name, parent_id, order_num, path, component, menu_type, visible, status, perms, icon, create_time) VALUES
<% for (let i = 0; i < btns.length; i++) { %>('<%= btns[i].name %>', @menuId, <%= i + 1 %>, '', '', 'F', '0', '0', '<%= btns[i].perms %>', '#', NOW())<% if (i < btns.length - 1) { %>,<% } else { %>;<% } %>
<% } %><% } %>
`,
  },
];

/** 字典分类模板种子（仅一个）：按分类生成 Java 字典常量类（每分类一个文件，含分类下全部字典与值） */
export const SEED_DICT_CATEGORY_TEMPLATE: CodeTemplate = {
  id: "tpl-dict-category",
  name: "dict",
  content: `<%
  // 分类属性推导产物路径与 Java 包名/类名：basePackage 基础包路径 + className 大驼峰类名；模板内可对 fileName/filePath 赋值覆盖
  const pkg = String(context.category.basePackage || "").trim();
  const cls = String(context.category.className || "").trim() || utils.toCamelCase(context.category.name) + "DictConstants";
  const pkgPath = pkg ? pkg.split(".").filter(Boolean).join("/") : "";
  context.fileName = cls + ".java";
  context.filePath = (pkgPath ? "src/main/java/" + pkgPath + "/" : "") + context.fileName;
  context.language = "java";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const pascal = (s) => utils.toCamelCase(s);
  // 常量名：字典值的常量属性名（propertyName，全大写）优先；缺省时由值键推导大写蛇形（数字键加 VALUE_ 前缀）。常量值统一为 String 类型
  const constName = (k) => /^[0-9]+$/.test(String(k)) ? "VALUE_" + k : String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  const nameOf = (v) => String(v.propertyName || "").trim() || constName(v.valueKey);
%>
<% if (pkg) { %>package <%= pkg %>;
<% } %>
<%# ===== 字典分类常量类（每个字典分类生成一份，含分类下全部字典与值） ===== %>
/**
 * <%= context.category.name %> 字典常量
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
public final class <%= cls %> {

  private <%= cls %>() {
  }
<% for (const dict of context.dicts) { %>

  /**
   * <%= dict.label %><% if (dict.comment) { %>：<%= dict.comment %><% } %>
   * 字典键：<%= dict.dictKey %>
   */
  public static final class <%= pascal(dict.dictKey) %> {

    /** 字典键 */
    public static final String KEY = "<%= dict.dictKey %>";
<% for (const v of dict.values) { %>
    /** <%= v.label %><% if (v.comment) { %>：<%= v.comment %><% } %> */
    public static final String <%= nameOf(v) %> = "<%= v.valueKey %>";
<% } %>
  }
<% } %>
}
`,
};
