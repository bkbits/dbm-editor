import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'antdv-next'
import 'antdv-next/dist/reset.css'
import '@/styles/index.scss'
import App from './App.vue'
import { useThemeStore } from '@/stores/theme'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(Antd)

// 应用挂载前同步主题（避免闪烁）
useThemeStore().init()

app.mount('#app')
