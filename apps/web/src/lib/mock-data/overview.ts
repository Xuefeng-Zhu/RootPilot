export interface TimeSeriesPoint {
  time: string;
  requests: number;
  errors: number;
  latency: number;
}

export const overviewSeries: TimeSeriesPoint[] = [
  { time: '11:15', requests: 68000, errors: 720, latency: 265 },
  { time: '11:16', requests: 71200, errors: 820, latency: 278 },
  { time: '11:17', requests: 74500, errors: 910, latency: 292 },
  { time: '11:18', requests: 72100, errors: 780, latency: 276 },
  { time: '11:19', requests: 76800, errors: 990, latency: 305 },
  { time: '11:20', requests: 73900, errors: 1040, latency: 314 },
  { time: '11:21', requests: 78100, errors: 920, latency: 298 },
  { time: '11:22', requests: 80400, errors: 1110, latency: 326 },
  { time: '11:23', requests: 79600, errors: 1060, latency: 318 },
  { time: '11:24', requests: 81200, errors: 1210, latency: 337 },
  { time: '11:25', requests: 83300, errors: 1170, latency: 329 },
  { time: '11:26', requests: 82100, errors: 1280, latency: 342 },
  { time: '11:27', requests: 84500, errors: 1320, latency: 356 },
  { time: '11:28', requests: 83800, errors: 1240, latency: 339 },
  { time: '11:29', requests: 86100, errors: 1370, latency: 371 },
  { time: '11:30', requests: 87200, errors: 1410, latency: 384 },
];
