export const parseDeviceType = (userAgent = "") => {
    const ua = (userAgent || "").toLowerCase();

    // Check mobile / tablet indicators
    const isMobile = /android|iphone|ipad|ipod|mobile|blackberry|iemobile|opera mini/i.test(ua);
    const isTablet = /ipad|tablet|(android(?!.*mobile))/i.test(ua);

    let deviceType = "Laptop";
    if (isTablet) {
        deviceType = "Tablet";
    } else if (isMobile) {
        deviceType = "Mobile";
    } else {
        deviceType = "Laptop";
    }

    // Identify OS
    let os = "Desktop";
    if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
    else if (/android/i.test(ua)) os = "Android";
    else if (/windows/i.test(ua)) os = "Windows";
    else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
    else if (/linux/i.test(ua)) os = "Linux";

    // Identify Browser
    let browser = "Chrome";
    if (/edg/i.test(ua)) browser = "Edge";
    else if (/opr|opera/i.test(ua)) browser = "Opera";
    else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
    else if (/chrome|crios/i.test(ua)) browser = "Chrome";
    else if (/safari/i.test(ua)) browser = "Safari";

    return {
        deviceType,
        deviceDetails: `${os} (${browser})`
    };
};
