import { describe, expect, it } from "vitest";
import { compactDeviceID, listNearbyDevices, preferLanAddress, shortDeviceID } from "./discovered-devices";

describe("nearby device helpers", () => {
  it("shows a short ID instead of the 56-character device ID", () => {
    expect(shortDeviceID("AIR6LPZ7K4PTTUXQSMUUCPQ5YWOEDFIIQJUG7772YQXXR5YD6AWQ")).toBe("AIR6LPZ");
    expect(compactDeviceID("air6-lpz7-k4pt")).toBe("AIR6LPZ7K4PT");
  });

  it("prefers a LAN address when several are advertised", () => {
    expect(
      preferLanAddress(["tcp://1.2.3.4:22000", "tcp://192.168.1.23:22000", "relay://example"]),
    ).toBe("192.168.1.23:22000");
  });

  it("lists pending and discovered devices, skipping ones already added", () => {
    const nearby = listNearbyDevices(
      {
        AIR6LPZ7K4PTTUXQSMUUCPQ5YWOEDFIIQJUG7772YQXXR5YD6AWQ: {
          addresses: ["tcp://192.168.1.8:22000"],
        },
        BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: {
          addresses: ["tcp://10.0.0.2:22000"],
        },
        DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD: {
          addresses: ["tcp://10.0.0.5:22000"],
        },
      },
      {
        CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC: {
          time: "2026-08-25T00:00:00Z",
          name: "书房电脑",
          address: "tcp://192.168.1.9:22000",
        },
      },
      new Set(["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"]),
      "AIR6LPZ7K4PTTUXQSMUUCPQ5YWOEDFIIQJUG7772YQXXR5YD6AWQ",
    );

    expect(nearby.map((item) => item.kind)).toEqual(["pending", "discovered"]);
    expect(nearby[0]?.name).toBe("书房电脑");
    expect(nearby[0]?.address).toBe("192.168.1.9:22000");
    expect(nearby[1]?.name).toBe("DDDDDDD");
    expect(nearby[1]?.address).toBe("10.0.0.5:22000");
  });
});
