import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createOrderStore, OrderContext } from "./workflow";

const store = createOrderStore({ persistKey: "order-dashboard" });

// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed to exist in index.html
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<OrderContext.Provider store={store}>
			<App />
		</OrderContext.Provider>
	</StrictMode>,
);
