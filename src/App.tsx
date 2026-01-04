import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { GatheringScreen } from './components/GatheringScreen'
import { LobbyScreen } from './components/LobbyScreen'
import { EntryScreen } from './components/EntryScreen'
import { WaitForEntriesScreen } from './components/WaitForEntriesScreen'
import { VotingScreen } from './components/VotingScreen'
import './App.css'

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<GatheringScreen />} />
          <Route path="/lobby/:gameId" element={<LobbyScreen />} />
          <Route path="/game/:gameId/entry" element={<EntryScreen />} />
          <Route path="/game/:gameId/waiting" element={<WaitForEntriesScreen />} />
          <Route path="/game/:gameId/voting" element={<VotingScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  )
}

export default App
