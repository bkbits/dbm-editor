import { createApp } from 'vue'
import Antd from 'antdv-next'
import 'antdv-next/dist/reset.css'
import '@/styles/index.scss'
import App from './App.vue'

const app = createApp(App)
app.use(Antd)

app.mount('#app')
