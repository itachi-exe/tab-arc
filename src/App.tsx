import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LandingPage from "./components/LandingPage";
import TryPage from "./components/TryPage";
import ClaimPage from "./components/ClaimPage";
import SplitPage from "./components/SplitPage";
import ConfirmPage from "./components/ConfirmPage";
import MePage from "./components/MePage";
import JoinPage from "./components/JoinPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/try" element={<TryPage />} />
        <Route path="/claim/:id" element={<ClaimPage />} />
        <Route path="/split/:id" element={<SplitPage />} />
        <Route path="/confirm/:id" element={<ConfirmPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
