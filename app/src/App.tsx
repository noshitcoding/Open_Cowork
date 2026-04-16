import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ChatView from './components/ChatView'
import TaskView from './components/TaskView'
import McpView from './components/McpView'
import SettingsView from './components/SettingsView'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<ChatView />} />
          <Route path="/tasks" element={<TaskView />} />
          <Route path="/mcp" element={<McpView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
