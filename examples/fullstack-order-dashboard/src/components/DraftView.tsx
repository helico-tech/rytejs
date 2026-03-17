import { type FormEvent, useState } from "react";
import type { Item } from "../workflow";
import { OrderContext } from "../workflow";

interface DraftViewProps {
	data: { customer: string; items: Item[] };
}

const buttonBase: React.CSSProperties = {
	padding: "8px 16px",
	borderRadius: 6,
	border: "none",
	fontWeight: 600,
	fontSize: 14,
	cursor: "pointer",
	transition: "opacity 0.2s",
};

export function DraftView({ data }: DraftViewProps) {
	const { dispatch, isDispatching } = OrderContext.useWorkflow();
	const [itemName, setItemName] = useState("");
	const [itemQty, setItemQty] = useState("1");
	const [itemPrice, setItemPrice] = useState("");

	const handleAddItem = (e: FormEvent) => {
		e.preventDefault();
		if (!itemName.trim() || !itemPrice.trim()) return;
		dispatch("AddItem", {
			name: itemName.trim(),
			quantity: Number(itemQty) || 1,
			price: Number(itemPrice) || 0,
		});
		setItemName("");
		setItemQty("1");
		setItemPrice("");
	};

	const handleSetCustomer = (value: string) => {
		dispatch("SetCustomer", { customer: value });
	};

	const total = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

	return (
		<div>
			{/* Customer name */}
			<div style={{ marginBottom: 20 }}>
				<label
					htmlFor="customer-name"
					style={{
						display: "block",
						fontSize: 13,
						fontWeight: 600,
						color: "#555",
						marginBottom: 6,
					}}
				>
					Customer Name
				</label>
				<input
					id="customer-name"
					type="text"
					value={data.customer}
					onChange={(e) => handleSetCustomer(e.target.value)}
					placeholder="Enter customer name..."
					style={{
						width: "100%",
						padding: "10px 12px",
						border: "1px solid #ddd",
						borderRadius: 6,
						fontSize: 14,
						outline: "none",
					}}
				/>
			</div>

			{/* Add item form */}
			<div
				style={{
					background: "#f9fafb",
					borderRadius: 8,
					padding: 16,
					marginBottom: 20,
				}}
			>
				<h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>Add Item</h3>
				<form onSubmit={handleAddItem} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<input
						type="text"
						value={itemName}
						onChange={(e) => setItemName(e.target.value)}
						placeholder="Item name"
						style={{
							flex: 2,
							minWidth: 140,
							padding: "8px 12px",
							border: "1px solid #ddd",
							borderRadius: 6,
							fontSize: 14,
							outline: "none",
						}}
					/>
					<input
						type="number"
						value={itemQty}
						onChange={(e) => setItemQty(e.target.value)}
						placeholder="Qty"
						min={1}
						style={{
							width: 70,
							padding: "8px 12px",
							border: "1px solid #ddd",
							borderRadius: 6,
							fontSize: 14,
							outline: "none",
							textAlign: "center",
						}}
					/>
					<input
						type="number"
						value={itemPrice}
						onChange={(e) => setItemPrice(e.target.value)}
						placeholder="Price"
						min={0}
						step="0.01"
						style={{
							width: 100,
							padding: "8px 12px",
							border: "1px solid #ddd",
							borderRadius: 6,
							fontSize: 14,
							outline: "none",
							textAlign: "right",
						}}
					/>
					<button
						data-testid="btn-add-item"
						type="submit"
						disabled={isDispatching || !itemName.trim() || !itemPrice.trim()}
						style={{
							...buttonBase,
							background: "#1976d2",
							color: "#fff",
							opacity: isDispatching || !itemName.trim() || !itemPrice.trim() ? 0.5 : 1,
						}}
					>
						Add
					</button>
				</form>
			</div>

			{/* Items list */}
			{data.items.length > 0 && (
				<div style={{ marginBottom: 20 }}>
					<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
						<thead>
							<tr style={{ borderBottom: "2px solid #eee" }}>
								<th style={{ textAlign: "left", padding: "8px 0", color: "#888", fontWeight: 500 }}>
									Item
								</th>
								<th
									style={{ textAlign: "center", padding: "8px 0", color: "#888", fontWeight: 500 }}
								>
									Qty
								</th>
								<th
									style={{ textAlign: "right", padding: "8px 0", color: "#888", fontWeight: 500 }}
								>
									Price
								</th>
								<th
									style={{ textAlign: "right", padding: "8px 0", color: "#888", fontWeight: 500 }}
								>
									Subtotal
								</th>
								<th style={{ width: 40 }} />
							</tr>
						</thead>
						<tbody>
							{data.items.map((item, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: items have no stable ID; index is the only key available
								<tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
									<td style={{ padding: "10px 0" }}>{item.name}</td>
									<td style={{ padding: "10px 0", textAlign: "center" }}>{item.quantity}</td>
									<td style={{ padding: "10px 0", textAlign: "right" }}>
										${item.price.toFixed(2)}
									</td>
									<td style={{ padding: "10px 0", textAlign: "right", fontWeight: 600 }}>
										${(item.price * item.quantity).toFixed(2)}
									</td>
									<td style={{ padding: "10px 0", textAlign: "center" }}>
										<button
											type="button"
											onClick={() => dispatch("RemoveItem", { index: i })}
											disabled={isDispatching}
											style={{
												background: "none",
												border: "none",
												color: "#dc2626",
												cursor: "pointer",
												fontSize: 16,
												padding: "0 4px",
												opacity: isDispatching ? 0.5 : 1,
											}}
											title="Remove item"
										>
											&times;
										</button>
									</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr style={{ borderTop: "2px solid #eee" }}>
								<td colSpan={3} style={{ padding: "10px 0", fontWeight: 600 }}>
									Total
								</td>
								<td
									style={{ padding: "10px 0", textAlign: "right", fontWeight: 700, fontSize: 16 }}
								>
									${total.toFixed(2)}
								</td>
								<td />
							</tr>
						</tfoot>
					</table>
				</div>
			)}

			{/* Submit button */}
			<div style={{ display: "flex", justifyContent: "flex-end" }}>
				<button
					data-testid="btn-submit"
					type="button"
					onClick={() => dispatch("Submit", {})}
					disabled={isDispatching}
					style={{
						...buttonBase,
						background: "#1976d2",
						color: "#fff",
						padding: "10px 24px",
						fontSize: 15,
						opacity: isDispatching ? 0.5 : 1,
					}}
				>
					{isDispatching ? "Submitting..." : "Submit Order"}
				</button>
			</div>
		</div>
	);
}
