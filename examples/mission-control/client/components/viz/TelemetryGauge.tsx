interface TelemetryGaugeProps {
	value: number;
	min: number;
	max: number;
	label: string;
	unit: string;
}

export function TelemetryGauge({ value, min, max, label, unit }: TelemetryGaugeProps) {
	const range = max - min;
	const pct = Math.min(Math.max((value - min) / range, 0), 1);
	const isHigh = pct >= 0.8;

	// Arc parameters: 270 degrees, starting from bottom-left (135deg) to bottom-right (405deg / 45deg)
	const cx = 60;
	const cy = 60;
	const r = 48;

	// Convert angle to SVG coordinates
	// Start at 135 degrees, end at 405 degrees (= 45 degrees), total sweep = 270 degrees
	const startAngle = 135;
	const totalSweep = 270;

	function polarToXY(angleDeg: number): [number, number] {
		const rad = (angleDeg * Math.PI) / 180;
		return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
	}

	const [bgStartX, bgStartY] = polarToXY(startAngle);
	const endAngle = startAngle + totalSweep;
	const [bgEndX, bgEndY] = polarToXY(endAngle);

	// Background arc (full 270 degrees)
	const bgPath = [`M ${bgStartX} ${bgStartY}`, `A ${r} ${r} 0 1 1 ${bgEndX} ${bgEndY}`].join(" ");

	// Value arc
	const valueSweep = totalSweep * pct;
	const valueEndAngle = startAngle + valueSweep;
	const [valEndX, valEndY] = polarToXY(valueEndAngle);
	const largeArc = valueSweep > 180 ? 1 : 0;

	const valuePath =
		pct > 0.001
			? [`M ${bgStartX} ${bgStartY}`, `A ${r} ${r} 0 ${largeArc} 1 ${valEndX} ${valEndY}`].join(" ")
			: "";

	const displayValue =
		value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
	const strokeColor = isHigh ? "hsl(var(--warning))" : "hsl(var(--cyan))";

	return (
		<svg
			viewBox="0 0 120 120"
			className="w-28 h-28"
			role="img"
			aria-label={`${label}: ${displayValue} ${unit}`}
		>
			{/* Background arc */}
			<path
				d={bgPath}
				fill="none"
				stroke="hsl(var(--muted))"
				strokeWidth="6"
				strokeLinecap="round"
				opacity="0.3"
			/>

			{/* Value arc */}
			{valuePath && (
				<path
					d={valuePath}
					fill="none"
					stroke={strokeColor}
					strokeWidth="6"
					strokeLinecap="round"
					style={{ transition: "stroke-dashoffset 0.5s ease-out" }}
				/>
			)}

			{/* Center value */}
			<text
				x={cx}
				y={cy - 2}
				textAnchor="middle"
				dominantBaseline="central"
				fill="hsl(var(--foreground))"
				fontSize="18"
				fontFamily="JetBrains Mono, monospace"
				fontWeight="bold"
			>
				{displayValue}
			</text>

			{/* Unit */}
			<text
				x={cx}
				y={cy + 16}
				textAnchor="middle"
				fill="hsl(var(--muted-foreground))"
				fontSize="9"
				fontFamily="JetBrains Mono, monospace"
			>
				{unit}
			</text>

			{/* Label */}
			<text x={cx} y={110} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">
				{label}
			</text>
		</svg>
	);
}
