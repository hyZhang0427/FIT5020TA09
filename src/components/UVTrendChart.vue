<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js'
import { melbourneUVHeatTrends } from '../data/melbourneUVHeatTrends.js'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  Legend,
)

const canvasRef = ref(null)
let chartInstance = null

const labels = melbourneUVHeatTrends.map(
  (d) => `${d.year}-${String(d.month).padStart(2, '0')}`
)
const uvData = melbourneUVHeatTrends.map((d) => d.uv)
const heatData = melbourneUVHeatTrends.map((d) => d.heat)

const peakIndices = melbourneUVHeatTrends
  .map((item, index, arr) => {
    const sameYear = arr.filter((d) => d.year === item.year)
    const maxUv = Math.max(...sameYear.map((d) => d.uv))
    return item.uv === maxUv ? index : null
  })
  .filter((i) => i !== null)

function renderChart() {
  if (!canvasRef.value) return

  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }

  const ctx = canvasRef.value.getContext('2d')

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'UV Index',
          data: uvData,
          borderColor: '#E53210',
          backgroundColor: 'rgba(229,50,16,0.08)',
          yAxisID: 'y',
          tension: 0.3,
          fill: false,
          pointBackgroundColor: labels.map((_, i) =>
            peakIndices.includes(i) ? '#FFD600' : '#E53210'
          ),
          pointBorderColor: labels.map((_, i) =>
            peakIndices.includes(i) ? '#B58900' : '#E53210'
          ),
          pointRadius: labels.map((_, i) => (peakIndices.includes(i) ? 7 : 4)),
          pointHoverRadius: labels.map((_, i) => (peakIndices.includes(i) ? 8 : 5)),
        },
        {
          label: 'Heat Index',
          data: heatData,
          borderColor: '#0077B6',
          backgroundColor: 'rgba(0,119,182,0.08)',
          yAxisID: 'y1',
          tension: 0.3,
          fill: false,
          pointRadius: 3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            color: '#0f172a',
            font: {
              size: 12,
              weight: '600',
            },
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          titleColor: '#ffffff',
          bodyColor: '#e5e7eb',
          padding: 12,
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(148, 163, 184, 0.14)',
          },
          ticks: {
            color: '#475569',
            maxTicksLimit: 10,
          },
          title: {
            display: true,
            text: 'Month',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
        },
        y: {
          type: 'linear',
          position: 'left',
          title: {
            display: true,
            text: 'UV Index',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
          min: 0,
          max: 12,
          grid: {
            color: 'rgba(148, 163, 184, 0.18)',
          },
          ticks: {
            color: '#475569',
          },
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Heat Index (°C)',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
          min: 0,
          max: 50,
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: '#475569',
          },
        },
      },
    },
  })
}

onMounted(() => {
  renderChart()
})

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
})
</script>

<template>
  <section class="chart-card reveal">
    <div class="chart-header">
      <p class="chart-kicker">UV Trend</p>
      <h2 class="chart-title">Melbourne UV Intensity and Heat Index Trends</h2>
      <p class="chart-subtitle">
        View monthly UV intensity and heat index changes over the past 5 years.
        Yellow-highlighted points mark peak UV periods.
      </p>
    </div>

    <div class="chart-wrap">
      <canvas ref="canvasRef"></canvas>
    </div>

    <p class="chart-note">
      Highlighted points: <strong>Peak UV periods</strong> for each year.
    </p>
  </section>
</template>

<style scoped>
.chart-card {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0 auto 24px;
  padding: 18px;
  border-radius: 14px;
  background: rgba(255, 253, 250, 0.92);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.08);
  box-sizing: border-box;
}

.chart-header {
  margin-bottom: 14px;
}

.chart-kicker {
  margin: 0 0 6px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
  font-weight: 700;
}

.chart-title {
  margin: 0 0 8px;
  font-size: clamp(1.05rem, 1.4vw, 1.35rem);
  line-height: 1.25;
  color: #0f172a;
  font-weight: 800;
}

.chart-subtitle {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #334155;
}

.chart-wrap {
  position: relative;
  width: 100%;
  min-width: 0;
  height: 340px;
}

.chart-wrap canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.chart-note {
  margin: 10px 0 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: #854d0e;
  font-weight: 600;
}

@media (max-width: 640px) {
  .chart-card {
    padding: 14px;
  }

  .chart-wrap {
    height: 300px;
  }

  .chart-subtitle {
    font-size: 0.86rem;
  }

  .chart-note {
    font-size: 0.8rem;
  }
}
</style>