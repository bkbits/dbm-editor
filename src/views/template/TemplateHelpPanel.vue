<script setup lang="ts">
/**
 * 模板页 · 帮助面板（模板上下文变量与工具速查）
 *
 * 从原 TemplateView.vue 单文件拆出。折叠状态内聚于本组件：
 * 移动端（≤768px）默认折叠；窄屏转宽屏时复位展开（桌面帮助面板始终
 * 可见）；反向切换保留用户当前状态。桌面端折叠开关隐藏（始终展开）。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ChevronDown, ChevronUp } from "@lucide/vue";

const helpOpen = ref(true);
let helpMq: MediaQueryList | null = null;

/** 视口断点变化：窄转宽复位展开，反向保留用户状态 */
function onHelpViewportChange(e: MediaQueryListEvent) {
  /* 窄屏转宽屏：复位展开（桌面帮助面板始终可见）；反向切换保留用户当前状态 */
  if (!e.matches) helpOpen.value = true;
}

onMounted(() => {
  helpMq = window.matchMedia("(max-width: 768px)");
  helpOpen.value = !helpMq.matches;
  helpMq.addEventListener("change", onHelpViewportChange);
});

onBeforeUnmount(() => {
  helpMq?.removeEventListener("change", onHelpViewportChange);
});
</script>

<template>
  <div class="tpl-help">
    <div class="help-title">
      <span>模板上下文变量（context）与工具（utils）</span>
      <button
        class="help-toggle"
        type="button"
        :aria-expanded="helpOpen"
        aria-label="展开 / 收起帮助面板"
        title="展开 / 收起帮助面板"
        @click="helpOpen = !helpOpen"
      >
        <ChevronUp v-if="helpOpen" :size="14" />
        <ChevronDown v-else :size="14" />
      </button>
    </div>
    <div v-show="helpOpen" class="help-grid">
      <div class="help-col">
        <p><code>context.templateName</code> 模板名称</p>
        <p><code>context.basePackage</code> 基础包名（表所属分类）</p>
        <p><code>context.fileName / filePath</code> 产物文件名/路径（模板内赋值）</p>
        <p>
          <code>context.language</code> 显式指定预览高亮语言，如
          <code>&lt;% context.language = 'java' %&gt;</code>（未设置时按文件后缀自动识别）
        </p>
        <p><code>context.table.tableName / className / comment</code> 表信息（表模板）</p>
        <p>
          <code>context.category.name / basePackage / className</code>
          字典分类信息（字典分类模板；basePackage 基础包路径、className 大驼峰类名——
          产物路径推导依据）
        </p>
        <p>
          <code>context.dicts</code>
          该分类下全部字典（dictKey/label/comment/values：valueKey/propertyName/label/labelType，propertyName
          为常量属性名）（字典分类模板）
        </p>
        <p>
          <code>context.table.columns</code>
          字段数组（columnName/propertyName/type/javaType/comment/notNull/primaryKey/dict）
        </p>
        <p><code>context.table.indexes</code> 索引数组（indexName/type/columns/comment）</p>
        <p>
          <code>context.table.navigates</code>
          单向导航（propertyName/type/comment/self/target/cascade/...）
        </p>
        <p><code>context.hasColumn(name)</code> 按列名判断列是否存在</p>
        <p><code>context.getColumn(name)</code> 按列名获取列（无则 undefined）</p>
        <p><code>context.settings.author</code> 代码作者（生成 javadoc @author）</p>
        <p>
          <code>context.aborted</code> 丢弃本次生成（默认 false；置 true 则该产物不打包进
          zip），例：<code>&lt;% context.aborted = true; return ""; %&gt;</code>
        </p>
      </div>
      <div class="help-col">
        <p><code>utils.toCamelCase(str, firstLower?)</code> 转驼峰</p>
        <p><code>utils.toSnakeCase(str)</code> 转蛇形</p>
        <p><code>utils.getJavaType(column)</code> 数据库类型映射 Java 类型</p>
        <p><code>utils.quote(content, cond?)</code> 引号包裹</p>
        <p><code>utils.wrap(content, cond?)</code> 括号包裹</p>
        <p><code>utils.isEmpty(str) / utils.isBlank(str)</code> 判空 / 判空白</p>
        <p><code>utils.nowDateTime()</code> 当前时间（yyyy-MM-dd HH:mm:ss，javadoc @since）</p>
        <p>
          <code>utils.optionEnabled(options, name)</code>
          读表/列选项是否启用（缺省视为启用），如
          <code>utils.optionEnabled(context.table.options, "add")</code>
        </p>
        <p>
          <code>&lt;% ... %&gt;</code> 逻辑 <code>&lt;%= ... %&gt;</code> 输出
          <code>&lt;%# ... %&gt;</code> 注释
        </p>
        <p>
          输出格式保证：最后一条 <code>import</code> 与后续代码之间自动空一行；
          <code>table.options / column.options</code>
          为表/列选项值（键为选项名称，见系统设置）
        </p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.tpl-help {
  flex-shrink: 0;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-2);
  padding: 8px 12px;

  .help-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
    margin-bottom: 4px;
  }

  .help-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 20px;
  }

  p {
    margin: 1.5px 0;
    font-size: 11px;
    color: var(--dbm-text-3);

    code {
      font-family: var(--dbm-font-mono);
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
      border-radius: 3px;
      padding: 0 3px;
    }
  }
}

/* 帮助面板折叠开关：桌面隐藏（面板始终展开），移动端样式见下方媒体查询 */
.help-toggle {
  display: none;
}

/* 移动端：可折叠 + 展开时限高内部滚动（单列自然高度约 400px，不限高会挤占代码区） */
@media (max-width: 768px) {
  .help-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .help-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--dbm-radius-s);
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;

    &:active {
      background: var(--dbm-bg-hover);
    }
  }

  .tpl-help {
    max-height: 40vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;

    .help-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
