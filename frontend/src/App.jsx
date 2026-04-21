import { useState } from 'react'
import HomePage from './HomePage'
import ResultPage from './ResultPage'

export default function App() {
  const [currentPage, setCurrentPage] = useState('home')
  const [selectedTask, setSelectedTask] = useState(null)

  const handleViewResult = (task) => {
    setSelectedTask(task)
    setCurrentPage('result')
  }

  if (currentPage === 'result') {
    return <ResultPage task={selectedTask} onBack={() => setCurrentPage('home')} />
  }

  return <HomePage onViewResult={handleViewResult} />
}
