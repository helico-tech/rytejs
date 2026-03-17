import type { Item } from "../workflow";

interface OrderSummaryProps {
	customer: string;
	items: Item[];
}

export function OrderSummary({ customer, items }: OrderSummaryProps) {
	const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

	return (
		<div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 16,
					paddingBottom: 12,
					borderBottom: "1px solid #eee",
				}}
			>
				<div>
					<span
						style={{ fontSize: 13, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}
					>
						Customer
					</span>
					<div style={{ fontSize: 16, fontWeight: 600 }}>{customer || "—"}</div>
				</div>
				<div style={{ textAlign: "right" }}>
					<span
						style={{ fontSize: 13, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}
					>
						Total
					</span>
					<div style={{ fontSize: 20, fontWeight: 700, color: "#1976d2" }}>${total.toFixed(2)}</div>
				</div>
			</div>

			{items.length === 0 ? (
				<p style={{ color: "#999", textAlign: "center", padding: "20px 0" }}>No items yet</p>
			) : (
				<table
					style={{
						width: "100%",
						borderCollapse: "collapse",
						fontSize: 14,
					}}
				>
					<thead>
						<tr style={{ borderBottom: "2px solid #eee" }}>
							<th style={{ textAlign: "left", padding: "8px 0", color: "#888", fontWeight: 500 }}>
								Item
							</th>
							<th style={{ textAlign: "center", padding: "8px 0", color: "#888", fontWeight: 500 }}>
								Qty
							</th>
							<th style={{ textAlign: "right", padding: "8px 0", color: "#888", fontWeight: 500 }}>
								Price
							</th>
							<th style={{ textAlign: "right", padding: "8px 0", color: "#888", fontWeight: 500 }}>
								Subtotal
							</th>
						</tr>
					</thead>
					<tbody>
						{items.map((item, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: items have no stable ID; index is the only key available
							<tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
								<td style={{ padding: "10px 0" }}>{item.name}</td>
								<td style={{ padding: "10px 0", textAlign: "center" }}>{item.quantity}</td>
								<td style={{ padding: "10px 0", textAlign: "right" }}>${item.price.toFixed(2)}</td>
								<td style={{ padding: "10px 0", textAlign: "right", fontWeight: 600 }}>
									${(item.price * item.quantity).toFixed(2)}
								</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr style={{ borderTop: "2px solid #eee" }}>
							<td colSpan={3} style={{ padding: "10px 0", fontWeight: 600 }}>
								Total
							</td>
							<td style={{ padding: "10px 0", textAlign: "right", fontWeight: 700, fontSize: 16 }}>
								${total.toFixed(2)}
							</td>
						</tr>
					</tfoot>
				</table>
			)}
		</div>
	);
}
