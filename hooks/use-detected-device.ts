"use client"

import * as React from "react"

import {
  detectDevice,
  refineDeviceArch,
  type DetectedDevice,
} from "@/lib/device"

export function useDetectedDevice() {
  const [device, setDevice] = React.useState<DetectedDevice | null>(null)

  React.useEffect(() => {
    const initial = detectDevice()
    setDevice(initial)
    void refineDeviceArch(initial).then(setDevice)
  }, [])

  return device
}