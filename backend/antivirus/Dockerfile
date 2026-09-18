FROM clamav/clamav:1.4.3
RUN printf '\nAlertExceedsMax yes\nMaxFileSize 51M\nStreamMaxLength 51M\nMaxScanSize 250M\nMaxScanTime 120000\nMaxRecursion 10\n' >> /etc/clamav/clamd.conf
