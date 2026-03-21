interface TrajectoryVizProps {
	altitude: number;
	maxAltitude?: number;
}

export function TrajectoryViz({ altitude, maxAltitude = 400 }: TrajectoryVizProps) {
	const pct = Math.min(altitude / maxAltitude, 1);
	const atOrbit = pct >= 1;

	// Layout constants
	const w = 600;
	const h = 400;
	const earthRadius = 600;
	const earthCenterY = h + earthRadius - 80;
	const atmosphereHeight = 40;
	const orbitY = 60;

	// Rocket position along trajectory arc
	// Arc from bottom-left to upper-right
	const startX = 80;
	const startY = h - 80;
	const endX = w - 80;
	const endY = orbitY;

	// Parametric arc: quadratic bezier
	const controlX = w * 0.35;
	const controlY = h * 0.15;

	// Position along bezier
	const t = pct;
	const rocketX = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * endX;
	const rocketY = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY;

	// Build trajectory path
	const trajectoryPath = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;

	// Partial trajectory path (trail) — approximate with same bezier up to t
	const trailEndX = rocketX;
	const trailEndY = rocketY;
	const trailControlX = startX + (controlX - startX) * Math.min(t * 1.5, 1);
	const trailControlY = startY + (controlY - startY) * Math.min(t * 1.5, 1);
	const trailPath = `M ${startX} ${startY} Q ${trailControlX} ${trailControlY} ${trailEndX} ${trailEndY}`;

	// Rocket rotation: tangent of bezier
	const dt = 0.01;
	const t2 = Math.min(t + dt, 1);
	const nextX = (1 - t2) * (1 - t2) * startX + 2 * (1 - t2) * t2 * controlX + t2 * t2 * endX;
	const nextY = (1 - t2) * (1 - t2) * startY + 2 * (1 - t2) * t2 * controlY + t2 * t2 * endY;
	const angle = Math.atan2(nextY - rocketY, nextX - rocketX) * (180 / Math.PI);

	// Star positions (deterministic)
	const stars = Array.from({ length: 30 }, (_, i) => ({
		cx: (i * 137 + 50) % w,
		cy: (i * 89 + 10) % (h * 0.6),
		r: i % 3 === 0 ? 1.5 : 0.8,
		opacity: 0.3 + (i % 5) * 0.12,
	}));

	// Altitude markers
	const altMarkers = [0, 100, 200, 300, 400];

	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			className="w-full h-auto"
			style={{ maxHeight: 320 }}
			role="img"
			aria-label={`Trajectory visualization at ${altitude.toFixed(0)} km altitude`}
		>
			<defs>
				{/* Earth gradient */}
				<radialGradient id="earthGrad" cx="50%" cy="0%" r="100%">
					<stop offset="0%" stopColor="#1e3a5f" />
					<stop offset="100%" stopColor="#0a1628" />
				</radialGradient>

				{/* Atmosphere gradient */}
				<linearGradient id="atmoGrad" x1="0" y1="1" x2="0" y2="0">
					<stop offset="0%" stopColor="#00d4ff" stopOpacity="0.15" />
					<stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
				</linearGradient>

				{/* Trail glow */}
				<linearGradient id="trailGrad" x1="0%" y1="0%" x2="100%" y2="0%">
					<stop offset="0%" stopColor="#00d4ff" stopOpacity="0" />
					<stop offset="100%" stopColor="#00d4ff" stopOpacity="0.8" />
				</linearGradient>

				{/* Orbit fill gradient */}
				<linearGradient id="orbitFill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#00d4ff" stopOpacity="0.05" />
					<stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
				</linearGradient>
			</defs>

			{/* Background */}
			<rect x="0" y="0" width={w} height={h} fill="#0a0e17" />

			{/* Stars */}
			{stars.map((star) => (
				<circle
					key={`star-${star.cx}-${star.cy}`}
					cx={star.cx}
					cy={star.cy}
					r={star.r}
					fill="white"
					opacity={star.opacity}
				/>
			))}

			{/* Earth arc */}
			<circle
				cx={w / 2}
				cy={earthCenterY}
				r={earthRadius}
				fill="url(#earthGrad)"
				stroke="#1e3a5f"
				strokeWidth="1"
			/>

			{/* Atmosphere layer */}
			<circle
				cx={w / 2}
				cy={earthCenterY}
				r={earthRadius + atmosphereHeight}
				fill="none"
				stroke="url(#atmoGrad)"
				strokeWidth={atmosphereHeight}
				opacity="0.5"
			/>

			{/* Altitude markers */}
			{altMarkers.map((alt) => {
				const markerPct = alt / maxAltitude;
				const markerY = startY - (startY - orbitY) * markerPct;
				return (
					<g key={`alt-${alt}`}>
						<text
							x="16"
							y={markerY + 4}
							fontSize="9"
							fill="#64748b"
							fontFamily="JetBrains Mono, monospace"
						>
							{alt}
						</text>
						<line x1="45" y1={markerY} x2="55" y2={markerY} stroke="#1e293b" strokeWidth="1" />
					</g>
				);
			})}

			{/* Orbit line */}
			<line
				x1="60"
				y1={orbitY}
				x2={w - 20}
				y2={orbitY}
				stroke="#00d4ff"
				strokeWidth="1"
				strokeDasharray="6 4"
				opacity="0.3"
			/>
			<text
				x={w - 16}
				y={orbitY - 6}
				fontSize="8"
				fill="#00d4ff"
				opacity="0.5"
				textAnchor="end"
				fontFamily="JetBrains Mono, monospace"
			>
				ORBIT
			</text>

			{/* Full trajectory path (faint guide) */}
			<path d={trajectoryPath} fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="4 4" />

			{/* Trail (covered portion) */}
			{pct > 0.01 && <path d={trailPath} fill="none" stroke="url(#trailGrad)" strokeWidth="2" />}

			{/* Orbit circle when at orbit */}
			{atOrbit && (
				<ellipse
					cx={w / 2}
					cy={orbitY}
					rx={200}
					ry={20}
					fill="none"
					stroke="#00d4ff"
					strokeWidth="1.5"
					opacity="0.4"
					strokeDasharray="8 4"
				/>
			)}

			{/* Rocket */}
			<g
				style={{
					transition: "transform 0.5s ease-out",
					transform: `translate(${rocketX}px, ${rocketY}px) rotate(${atOrbit ? -90 : angle}deg)`,
				}}
			>
				{/* Exhaust glow */}
				{!atOrbit && (
					<circle cx={-10} cy={0} r={4} fill="#00d4ff" opacity="0.3">
						<animate attributeName="r" values="3;6;3" dur="0.4s" repeatCount="indefinite" />
						<animate
							attributeName="opacity"
							values="0.3;0.1;0.3"
							dur="0.4s"
							repeatCount="indefinite"
						/>
					</circle>
				)}

				{/* Body */}
				<rect x={-6} y={-3} width={12} height={6} rx={1} fill="#e2e8f0" />

				{/* Nose cone */}
				<polygon points="6,-3 6,3 12,0" fill="#00d4ff" />

				{/* Fins */}
				<polygon points="-6,-3 -8,-6 -4,-3" fill="#64748b" />
				<polygon points="-6,3 -8,6 -4,3" fill="#64748b" />
			</g>
		</svg>
	);
}
