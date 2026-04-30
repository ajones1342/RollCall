import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import GMDashboard from './pages/GMDashboard';
import CampaignManage from './pages/CampaignManage';
import JoinCampaign from './pages/JoinCampaign';
import PlayerEdit from './pages/PlayerEdit';
import Overlay from './pages/Overlay';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/gm" element={<GMDashboard />} />
        <Route path="/gm/:campaignId" element={<CampaignManage />} />
        <Route path="/join/:campaignId" element={<JoinCampaign />} />
        <Route path="/play/:campaignId" element={<PlayerEdit />} />
        <Route path="/play/:campaignId/:characterId" element={<PlayerEdit />} />
        <Route path="/overlay/:campaignId" element={<Overlay />} />
        <Route path="/overlay/:campaignId/:characterId" element={<Overlay />} />
      </Routes>
    </BrowserRouter>
  );
}
