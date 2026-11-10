const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
export const isAndroid = params?.get('android') === '1'
export const isIOS = isAndroid && params?.get('ios') === '1'
