/**
 * 库入口（vite build 产物 DBManager.js / DBManager.d.ts 的导出面）
 *
 * - DBManagerView：数据库模型管理页面组件（可选 prop api 注入自定义实现）
 * - types/model 的全部契约类型（ManagerApi 接口 + 各 DTO/VO/实体类型），
 *   供宿主项目实现 ManagerApi 时使用
 *
 * vue / antdv-next / @lucide/vue 为外部依赖（peerDependencies），
 * 由宿主项目提供，不打包进产物。
 */
export { default as DBManagerView } from "./views/DBManagerView.vue";
export type * from "./types/model";
