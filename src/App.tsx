import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import GMDashboard from './pages/GMDashboard';
import CampaignManage from './pages/CampaignManage';
import ThemeEditor from './pages/ThemeEditor';
import JoinCampaign from './pages/JoinCampaign';
import CoGmJoin from './pages/CoGmJoin';
import PlayerEdit from './pages/PlayerEdit';
import Overlay from './pages/Overlay';
import CombatOverlay from './pages/CombatOverlay';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/gm" element={<GMDashboard />} />
        <Route path="/gm/:campaignId" element={<CampaignManage />} />
        <Route path="/gm/:campaignId/theme" element={<ThemeEditor />} />
        <Route path="/join/:campaignId" element={<JoinCampaign />} />
        <Route path="/co-gm-join/:campaignId" element={<CoGmJoin />} />
        <Route path="/play/:campaignId" element={<PlayerEdit />} />
        <Route path="/play/:campaignId/:characterId" element={<PlayerEdit />} />
        <Route path="/overlay/:campaignId" element={<Overlay />} />
        <Route path="/overlay/:campaignId/combat" element={<CombatOverlay />} />
        <Route path="/overlay/:campaignId/:characterId" element={<Overlay />} />
      </Routes>
    </BrowserRouter>
  );
}
