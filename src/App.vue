<script setup lang="ts">
/**
 * 应用根组件：渲染数据库模型管理页面（DBManagerView）
 * 页面壳、主题与页面切换（v-if）均封装于 DBManagerView；
 * 未传 api 属性时使用内置 DemoManagerApi 演示实现。
 * 对接真实后端时在此传入自定义 ManagerApi 实现：
 *   <DBManagerView :api="myManagerApi" />
 */
import DBManagerView from '@/views/DBManagerView.vue'
</script>

<template>
  <DBManagerView />
</template>
