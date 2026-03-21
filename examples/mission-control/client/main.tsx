import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";

function App() {
	return <div className="p-8 text-center">Mission Control — loading...</div>;
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
