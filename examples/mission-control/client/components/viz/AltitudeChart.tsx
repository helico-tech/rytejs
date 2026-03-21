interface AltitudeChartProps {
	readings: Array<{ altitude: number }>;
}

export function AltitudeChart({ readings }: AltitudeChartProps) {
	if (readings.length < 2) return null;

	const maxAlt = Math.max(...readings.map((r) => r.altitude), 1);
	const w = 600;
	const h = 100;
	const padding = 4;

	const points = readings.map((r, i) => {
		const x = padding + (i / (readings.length - 1)) * (w - padding * 2);
		const y = h - padding - (r.altitude / maxAlt) * (h - padding * 2);
		return { x, y };
	});

	const first = points[0];
	const last = points[points.length - 1];

	const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

	// Gradient fill area: close the polyline along the bottom
	const areaPoints = [
		...points.map((p) => `${p.x},${p.y}`),
		`${last?.x},${h}`,
		`${first?.x},${h}`,
	].join(" ");

	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			className="w-full"
			style={{ height: 80 }}
			role="img"
			aria-label="Altitude history chart"
		>
			<defs>
				<linearGradient id="altFill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#00d4ff" stopOpacity="0.2" />
					<stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
				</linearGradient>
			</defs>

			{/* Fill area */}
			<polygon points={areaPoints} fill="url(#altFill)" />

			{/* Line */}
			<polyline
				points={linePoints}
				fill="none"
				stroke="#00d4ff"
				strokeWidth="2"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>

			{/* Latest point dot */}
			<circle cx={last?.x} cy={last?.y} r="3" fill="#00d4ff">
				<animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
			</circle>
		</svg>
	);
}
