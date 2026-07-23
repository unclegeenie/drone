import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("시뮬레이터를 표시할 화면을 찾지 못했습니다.");
}

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
