import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WelcomePage from './pages/WelcomePage';
import MainLayout from './components/MainLayout';
import TreePage from './pages/TreePage';
import PersonsPage from './pages/PersonsPage';
import PersonEditPage from './pages/PersonEditPage';
import PersonDetailPage from './pages/PersonDetailPage';
import SettingsPage from './pages/SettingsPage';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route element={<MainLayout />}>
          <Route path="/tree" element={<TreePage />} />
          <Route path="/persons" element={<PersonsPage />} />
          <Route path="/person/:id/edit" element={<PersonEditPage />} />
          <Route path="/person/:id" element={<PersonDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
