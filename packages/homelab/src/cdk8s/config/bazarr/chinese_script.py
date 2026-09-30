"""Strict Simplified Chinese detection for Bazarr provider overlays.

The embedded data is generated from OpenCC's Apache-2.0 STCharacters.txt and
TSCharacters.txt tables. It identifies characters that occur exclusively in
one writing system; shared Han characters provide no script evidence.
"""

from __future__ import annotations

import base64
import zlib

from subliminal_patch.exceptions import APIThrottled
from subliminal_patch.subtitle import Subtitle

_DATA = (
    "eJwcm9easswShc/3VZtzBhVzDoCKYgJRvJih0pmXsOv7n2fe0YHuVatWozQH89d6/rU+f+3iX7v01zb/2vafUfgzNn/G+c8s//Uq"
    "f73pn9X4G3p/o9TfaPY3mv+NVn+j9d/o+zcr/M3Gf7PN36Lxt7b+1p+/jfO3a/7tWn+79t9u9rc7/+3dv2Pj79j8O67+juu/4+3v"
    "Yv9dTn/+9+9q/l27f9f533Xxd13+XT9/t+rfo/z3ePw9Pn+v+l+U/4uaf5GVpDZJupdk7kk2n+TLSX6W5J2k6CfldVJ7JLVnUguS"
    "WpjUXkktSmrvpPZJanFS+yb1VFJPJ/V50jgkzUnS/iSGkRjdxOglxj7p9xJrlFjTZFBJBrVkYCTjVTJeJ+NNMt4lYzuZDJJpLZnW"
    "k2kjmbaS2TJZppJlOllmks0r2XySTZxsvsk2lWzTyTaTbLPJNp9sC8n2kWyfiZ1Ljk7iZRMvl3j5xJ8k/jTxZ4k/T/xF4i8Tf5Xc"
    "jORmJrducuslt35ys5LbIHmckqCRBEYSDJNglATjJJgkwTIJ1kmwSYJdEjhJcEuCVxJ8kiBOwlISlpOwloStJDSTcJ6EiyTcJuE5"
    "CS/Jq5y8mslrmLx2yctOXn7yuievIHl9kyifRI0kaieRkUROEh2Sdz95W8l7mLxHyXuavGfJe568F8l7lbzXyXuTvLfJe5e8neTt"
    "Jh8j+WySeJ7EqyTWN9sk3iXxPontJHaS+JDEx+S7Sr7b5LtPvnbydZKvm3yPkHpBKob0AdIRpPXNFzJryGwgs4PMHjI25L6Qb0O+"
    "B/kz5K+Qv0E+hHwE+Q8U0lDIQ6EEhRoUBlAYQWEMBQ8KPhSuULhDIYJiCoo5KJah2IRiG4ojKK6h6ELxCEUPijrgC6U6lCwoDaA0"
    "hNIISnMouVA6QOkIpRBKHyjFUPpCOQXlDJRbUG5DeQPlHVQmUJlCZQGVJVT2ULlAxYfKFSpfqFahOoRaCmpbqJ2g9oJaBPUG1JtQ"
    "70K9B/Ul1NdQ30HdhfoN6i9o5KFRgEYZGlVo1KBRh0YLGl1oLKGxgsYWGnto2NA4QeMLzTQ0M9AsQLMIzRo029C0oDmA5hyaT2iG"
    "0PxAy4BWF1p9aO2hdYCWB60btFvQ7kDbgHYX2j1o96FtQXsA7RG0x9BpQmcAnRF0JtBZg1EHow1GBwwDDBOMLhh9MAZgjMGYgDED"
    "cwTmBMw5mAswl2CuobuD7gG6R+ieoOtB9wzdG3QD6D2h94FeDH0X+lewLLDWYF1gMIbhCkZLGB1hdIHRDUZ3GH1gFMO4AOMVjEMY"
    "v2DShEkfJkOYjGAyhskEJlOYzGAyh2kOpnmYFmDagekWpjZMXZgeYerB9AJTH6Y3mFkwG8BsCPM2zLuwKMByAKsTrM6wusLqAasA"
    "1jlYF2Fdh/UM1jdYh7B+wSYNmwxsqrDpwWYD2wJsi7AtwdaGrQNbF3Z92IWwz8E+D/sC7IuwL8H+Ansf9jewr2Dr7zvYD3AccI7g"
    "dsA1wb3A4QnHARy3cHTglIbTBE5TOM3htICTHnHh9IFTDN4EvBC8CLw3eF84F+BswtmC8wTOOzjf4PyBSwYuWbiU4VKByxQuC7hs"
    "4fIFPw1+Bvwe+H3wLfCH4I/AP4L/Af8L1yxcc3BdwHUF1zVcN3DdwvUMtwzcsnDLwe0IdwvuQ7hP4JmHpw1PD4I0BHkIShA0IWhB"
    "MIZgC8EOghMEFwgiCN4QZiB8wCsHrwK8KvBqwasNLwNeJrwG8JrCawavN0QOvFPwzsA7C+82vOfw3sBbD3rwDuH9gk8HPgZ8uvCZ"
    "wWcLnz18IohzEHfhW4BvE747+MaYSmEqjakMprKYymEqj6kCpsaYijD1xtQX01VMdzB9xfQD0wGmQ0y/MB1h+o3pD2a2mHExc8DM"
    "ETMnzHiYrWB2h9k9Zm3Mupg9YPaI2RNmPczNMbfG3BbzbcwfsdjGYgeLJpYKWKpiqYmlPpYsLB2w5GHpieU2lndYtrHsYNnF8gHL"
    "Z6wMsTLCygwrc6wssLLEyhorG6zmsTrD6hKrK6zqn1us7rC6x6qNtSHWRlgbY22CtSnWZlibY22BtSXWVlhbY22DtS3WJ1ifYn2G"
    "9QXWl1hfYeOKjRs2ntgIsPHCxhubH2zG2PxiK4WtNLYy2MphK4+tF7Zz2M5ju4DtIrZL2K5gJ4edNnbu2HliJ8DOC40xGlM0O9it"
    "YXeI3RF2beyesVfFnoE9G3tH7M+xv8P+A/tP7AdoDdC6o/VG64NWjIMqDjo4MHBg4qCLgx4OMzjM43CHYw/HL5ykcJLBSRYnC5xs"
    "cLLHiY3THE6nOF3idIXTDU53ON3j1MGpi9MjzuY4++A8hfM8zos4L+G8jPMKzqs4r+G8gfMmzts47+H8ifMYF3NcLHCxxMUKF2tc"
    "bHCxxcUOF3tc2LhwcLnF5RuXMS6/uErhKo2rDK7TuJ7geobrOa6XuF7j2sX1Edcn3Lxxm8NtHrdF3JZwW8btBHdD3I1wN8PdHPcO"
    "7j3cX9DeoK2/Q7Tf6Nh4WOJhjYcdHt94SuOpiKcqnjp4MvA0xNMCTzf00uhl0OuiN0Bvgd4dvQeei3g28bzEs41nHy9FvJTxssZL"
    "iH4O/Rn6C/RX6K/R36C/RX+H/h59G30Hr1O86u8HXp94DfD6wmuE1zdeP3iN8ZbGWwdvb7xn8Z7HewHvRbyX8F7GewXvVbzX8d7A"
    "exPvLby38d7Bu4F3E+9dfAzxMcLHBB9TfMzwMcfHAh9LfKzwscbHFh87fOzxYWNQwaCGQR2DBgYtDNoYmBj0MOhjYGMYY/jFVxpf"
    "WXzl8VXAVxGjPkZDjKYYzTCaY7TAaInRGqMNRluM9hjZGDn4KeCniJ8qfur4GePnhvEI4zF+2/jtULpJ6SOlPUrfKf2gdEzpL2VS"
    "lClTpkeZMWUmlAkp86bMh7JpymYom6XsiLIzym4pu6PsnrI2ZV3KHih7pFyXcj3KWZS/UelCpSeV61TeUvlO5RdVKlR5UOVJlYAq"
    "IVVLVJ1QdUrVA1WPVD1R1aPqmaoXqvpUy1KtQbUu1RZUc6jmUu1AtRPVj9RoU2NAjSE1RtQ4UcOjxpkaF2q8qNmiZpuaZ2r61GpQ"
    "q0mtFrXe1H5Q+0ntgDoNMjpknMjwyLyTGVE3T90b9XrU61NvRr059RbUO1DvSL0T9TzqXah3o36J+mXqd6jfo/6e+g71XerfyMqT"
    "VSCrT5ZFlkOWS1ZM1pcGUxqsaODSsE3DCw19GjVp1KJRm0Y9GvVpZNG4TuMtjQ80SdOkRZM2TQs07dDUpplLswfNYpp9aZ6ieZrm"
    "PZr3aT6k+ZjmL5pHNI9pkaJFmhZdWvRo0afFgBZDWtxpWafliJZjWl5o/aZNljYN2ixp49HmSZuAtina5mibp21EuyztCrSzaOfR"
    "7ky7D+1i2hdo36D9ivZXsttkT8l+kpMlp05Og5w2OWNyJuRsyNmScyS3R+6UDlk6VOlg0qFLhxcd3nSI6Tik44iOYzpO6BjS8U1H"
    "PfilU4pOBp22dNrRaU8nm04OnVzy2uQZ5J3I88i70LlHlzRdbnSJ6PImf0z+hPw1+Q75J/I/dE3TtUjXOt12dH/S801BgV4zes3p"
    "taDXkl4req3ptaHXll47eu3pZdPLoZdLrwO9jvQ60cuj15leF3r59LrS60avO70e9HrSK6BXSK8XvSJ6ven1oVdMry9FKYrSFGUo"
    "ylKUoyhPUYGiIkUlisoUVSiqUlSjqE5Rg6ImRS2K2hR1KDIoMinqUtSjqE+RRdGAoiFFI4rGFE0omlI0o2hO0YKiJUUritYUbSja"
    "UrSjaE+RTZFDkUvRgaIjRSeKPIrOFF0o8im6UnSj6E7Rg6InRQFFIUUviiKK3hR9KIop+tI7Re80vTP0ztI7R+88vQv0LtK7RO8y"
    "vSv0rtK7Ru86vRv0btK7Re82vTv0Nuht0rtL7x69+/S26D2g95DeI3qP6T2h95TeM3rP6b2g95LeK3qv6b2h95beO3rv6W3T26G3"
    "S+8DvY/0PtHbo/eZ3hd6+/S+0vtG7zt9MvRp06dPnyF9lvS5UZymeEbxguI1fS36Dug75NSSUztOBZyKOJ3hdJXTNU7XOW1y2ua0"
    "w5ksZ+acWXPmxJkbZ2LOfDmb4myaswXO7ji756zDWZezD86VOVfnXJNzLc61OWdwzuTckHMXzunZgPMW54+cjzj/5vyH8zEX2lwc"
    "c6nApRWXzly6cCni8pnLVy6/uJLhSokrfa6MubLlapqrRa6WuFrlao2rda42uNrk6o5rDa41udbmmsm1Ltd2XC9wfcD1IddHXB9z"
    "fcL1KddnXJ9zfcH1FdfXXN9wfct1Hbznus11h+su1w9cP3L9xHWPG3luXLjhc+PKjRs3Htx4ciPgRsiNFzfe3Bpya8KtNbc23Npy"
    "a8etPbcv3Elxp8idMneq3Klxp8nGhI0ZG3M2Vmxs2NiymWHzyWbI5ovNN3fP3PW5e+PeifsG929s9XjQ5EGbB0MeHHhw4sGFBx8e"
    "xDz48jDFwzQPMzzM8rDLwwOPKjxq8KjJoxOPzjy68Mjn0ZVHNx53edznSZEnJZ6UefLmSczTFE/3PGvyIs8LkxcbXhx4ceJljpd5"
    "XhZ4OeblkZcer/K8KvCqxKslr1a8WvNqw+sRr2+86fIuzbsM77K8y/Euz7sC74q8K/GuzLsK76q8q/GuzrsG75q8a/Guzbsp77a8"
    "83g/ZHvGTpmdCp/mfFrwacmnFZ/WfNrwacunHZ/2fLL55PDJ5dOBT0c+nfjk8enMpwuffD5d+XTj051PDz49+RTwKeTTi08Rn958"
    "+vAp5tOXvRR7afYy7GXZy7GXZ6/AXpG9Entl9irsVdmrsVdnr8Fek70We232OuwZ7Jnsddnrsddnz2JvwN6QvRF7Y/Ym7E3Zm7E3"
    "Z2/B3pK9FXtr9jbsbdnbsbdnz2bPYc9l78Dekb0Tex57Z/Yu7PnsXdm7sXdn78Hek72AvZC9F3sRe2/2PuzF7H35nOJzms8ZPmf5"
    "nONzns8FPhf5XOJzmc8VPlf5XONznc8NPjf53OJzm88dPht8Nvnc5XOPz30+W3we8HnI5xGfx3ye8HnK5xmf53xe8HnJ5xWf13ze"
    "8HnL5x2f93y2+ezw2eXzgc9HPp/47PH5zOcLn30+X/l84/Odzw++nPg24duUbzO+zfm24NuSbyu+rfm24duWbzu+7flm883hm8u3"
    "A9+OfNNZHt/OfLvwzefblW83vt359uDbk28B30K+vfgW8e3Ntw/fYr59+Z7ie5rvGb5n+Z7je57vBb4X+V7ie5nvFb5X+V7je53v"
    "Db43+d7ie5vvHb4bfDf53uV7j+99vlt8H/B9yPcR38d8n/B9yvcZ3+d8X/B9yfcV3x2+3/n+4EeVHxd+BPzM8jPHzyk/7/x88PPJ"
    "Tz0Y8jPioMaBw8GBA4/DNocdDs8cfvnV5NeYXx6/3/zZ8mfHnz1/bP44/HH5c+DPkT8n/nj8OfPnwh+fP1f+3Phz58+DP0/+BPwJ"
    "+fPiT8QfFfnwJ+bPl+MUx2mOMxxnOc5xnOe4wHGR4xLHZY4rHFc5rnFc57jBcZPjFsdtjjscGxybHHc57nHc59jieMDxkOMpxzbH"
    "Lschxx+OY/6m+Vvkb4m/Lf5a/B3wd8TfMX8n/J3yd8Zfm79X/oaSKkuqIqmOpLaSiiTdl/RGMoZkJpI5SOYkmVAyL8lEkm1KtiXZ"
    "tmQNyW4lu5NsIPmM5CeS30r+IvmP5GPJf6XQk2JFyjepnKQWSycvnYJ0itIpSacsnYp0qtKpSacunYZ0mtJpSactnY50DOmY0ulK"
    "pyedvnQs6QykM5TOSDpj6UykM5XOTDpz6Syks5TOSjpr6Wyks5XOTjp76djScaTjSucgnaN0TtLxpHOWzkU6vnSu0rlJ5y6dh3Se"
    "0gmkE0rnJZ1IOm/pfKSjbr9ipMRIi5ERIytGToy8GAUximKUxCiLURGjKkZNjLoYDTGaYrTEaIvREcMQwxSjK0ZPjL4YlhgDMYZi"
    "jMQYizERYyrGTIy5GAsxlmKsxFiLsRFjK8ZOjL0YthiOGK4YBzGOYpzE8MQ4i3ERwxfjKsZNjLsYDzGeYgRihGK8xIjEeIvxESMW"
    "4ytmSsy0mBkxs2LmxMyLWRCzKGZJzLKYFTGrYtbErIvZELMpZkvMtpgdMQ0xTTG7YvbE7ItpiTkQcyjmSMyxmBMxp2LOxJyLuRBz"
    "KeZKzLWYGzG3Yu7E3Itpi+mI6Yp5EPMo5klMT8yzmBcxfTGvYt7EvIv5EPMpZiBmKOZLzEjMt5gfMWMxv9JNSTct3Yx0s9LNSTcv"
    "3YJ0i9ItSbcs3Yp0q9KtSbcu3YZ0m9JtSbct3Y50Dema0u1KtyfdvnQt6Q6kO5TuSLpj6U6kO5XuTLpz6S6ku5TuSrpr6W6ku5Xu"
    "Trp76drSdaTrSvcg3aN0T9L1pHuW7kW6vnSv0r1J9y7dh3S/0t9L35a+I31X+gfpH6V/kr4n/bP0L9L3pX+V/k36d+k/pP+UfiD9"
    "UPov6UfSf0v/I/1Y+l+xUmKlxcqIlRUrJ1ZerIJYRbFKYpXFqohVFasmVl2shlhNsVpitcXqiGWIZYrVFasnVl8sS6yBWEOxRmLN"
    "xLqKdRPrLtZDBnkZFGRQlEFJBmUZdGWwlcFOBnsZ2DJsyrAlw4cMPzKMZdSU0VxGVxnFMk7LuCzjhYyPMjFkYspkIJONTNsy7cjU"
    "k6kvs63MdjLby8yWmSMzV2YHmd1loT8PWTxlEcgilMVLFpEs3rL4yCKWxVeWKVmmZZmRZVaWOVnmZVmQZVGWJVmWZVmRZVWWNVnW"
    "ZdmQZVOWLVm2ZdmRpSFLU5ZdWfZk2ZelJcuBLIeyHMlyLMuJLKeynMlyLsuFLJeyXMlyLcuNLLey3MmqIaumrFqyasuqIytDVqas"
    "urLqyaovK0tWA1kNZTWV1V7WddmsZLOWzUY2W9nsZLOXjS0bRzaubA6yOcrmJBtPNmfZXGTjy+Yqm5ts7rJ5yOYpm0A2oWxesolk"
    "85bNRzaxbL6yTck2LduMbLOyzck2L9uCbIuyLcm2LNuKbKuyrcm2LtuGbJuybcm2LduObA3ZmrLtin0Q+yj2SWxP7LPYF7F9sa9i"
    "38S+i/0Q+yl2IHYo9kvsSOy32B+xY7G/4qTESYuTEScrTk6cvDgFcYrilMQpi1MRpypOTZy6OA1xmuK0xGmL0xHHEMcUpytOT5y+"
    "OJY4A3GG4ozEGYszEWcqzkycuTgLcZbirMRZi7MRZyvOTty8uFVxa3Iw5PCQY1GOZbm85fKRSyyXr/gp8dPiZ8TPip8TPy9+Qfyi"
    "+CXxy+JXxK+KXxO/Ln5D/Kb4LfHb4nfEN8Q3xe+K3xO/L74l/kD8ofgj8cfiT8Sfij8Tfy7+Qvyl+Cvx1+JvxN+KvxN/L74tviO+"
    "K/5B/KP4J/E98c/iX8T3xb+KfxP/Lv5D/Kf4gfih+C/xI/Hf4n/Ej8X/yjUl17RcM3LNyjUn17xcC3ItyrUk17JcK3KtyrUm17pc"
    "G3JtyrUl17ZcO3I15GrKtSvXnlz7crXkOpDrUK4juY7lOpHrVK4zuc7lupDrUq4rua4lmEkwl2AhwVKClQR6ZCPBVoKdBHsJbAkc"
    "CVwJDhIcJThJ4ElwluAigS/BVYKbBHcJHhI8JQgkCCV4SRBJ8JbgI0EswVfClIRpCTMSZiXMSZiXsCBhUcKShGUJKxJWJaxJWJew"
    "IWFTwpaEbQk7EhoSmhJ2JexJ2JfQknAg4VDCkYRjCScSTiWcSTiXcCHhUsKVhGsJNxJuJdxJuJfQltCR0JXwIOFRwpOEnoRnCS8S"
    "+hJeJbxJGMtrK69AXqG8XvL6SJSTqCzRQiJbIkeiWN5VedfkXZd3KJ+WfNry+UqckjgtcUbirMQ5ifMSFyQuSlySuCxxReKqxDWJ"
    "BxIPJR5JPJNvQ75N+Xbka/7mqfg3L/jK9zcvhr95OaP0f/Nq4TcfXn/zUV7R9yMdt5j/5qfHb+7NFH1/vijP3/wy/c39zW9+GynL"
    "3/weKPFvUU0pfWX9W9RXv0Un91tM5r/FtKpcfov57LfY7H6L41g5/BbXrNL5LR633yLQ969/5H7Laum37Bu/pTVQJsr0txw0lZbS"
    "VjqKnh95v+U8/Vsu9fhOcSuKjnUPv+Whrmx/y6PO+8S/VTb9WxVav1Vp9VvV94qnnH+rRvu3ai5/q1ZXWf9W7cdv1an9Vsb3tzL1"
    "tV9Rqsrgt7J0vmUoN+X5Ww2Hv9W08Vvt37/VUed6qn2Z/FZ+X7F+q2vht3rYiqscf6unzgl0zEvHvz6/1ef5WxcWyvK3LmaVnHJU"
    "wt+69FD0fCWlnH/ravO3bryU6LceeL/1ROdMdc50/VvPq7/1VsfZn9/6qhqPirL7rSN9/ejYWM99/d8mvfxt8pZyU76/TWH32xT1"
    "WGPy27Rmiqeclei3mW5/m13mt7H1uP36bdzVb3NIKVNl/tscy7/NqaqMlfi3uZi/Tbj5bV55pfjblkpKWakqNaWhNJWW0lY6iqGY"
    "SlfpKX3FUgbKUBkpY2WiTJWZMlcWv21dX0f733by/m1nOm9v/7Zn1T/fftuHjntEv23U/e3KLWX629U2v12zp/R/u3bzt+scf7ux"
    "Mpkou9/u5Px2Vx0ftpWOYiim8u+Yzgt13rf026fSyuW3T99++8zrt8/lfvv8SHGVw2+vn6V9K68UlKKic1plpfLbt8Pffnb97ef7"
    "334xUHT++vzbn2Pl+9tfUorqXzJKVlHti2pdVOuiWhfVuqjWRbUuVaWm1JWG0lRaSlvpKIZiKl2l99s/VT9Q/UD1A9XXz9s+UP1A"
    "9QPVD1Q/UO1AtQPVDlQ7UN3AUmY/u/lWPkqsfH92K/WzjerP7nWVntL/2YONslV2yl6xFUdxlYNyVE6Kp5x/9kx15qqjn2F7nlGy"
    "Sl4pKEWlpJSViqK15jWloTSV+c9eaN2d1ttprZ3W2mmtndbaaa2d1tpprZ3W2mmt3UXxlatyU+7KQwmUlxIp2uNOPe3V01497dXT"
    "Xj3tc4r62quvvfraq6+9+tqrr7362quvfV1Rb3v1tm/9bFvHHFbK+mcfw5/tdX72WX34+nrT8R899tG6H6370bofzVa/p+yP1o+1"
    "dqy1Y60da+1Ya8daO9baserGWjfWurHqxI2fo9/hTjmr5JS8UlBKSlmpKFWlptSVf+ObSktpKx3FVLo/p6FzGjqnoXMaOqehc9qq"
    "Zx5/zlDnDHXOWOdPJz9npq8zfdX1c/R73ZkvlKtyVwLlpXx+zkLPL9TbQvUWqrEYKVNFzy9VX7+7naV6WGr9ZU+ZKydFNVbax0rP"
    "raKfs9be1sOfs9HzG1c5K9+fs1P9nfVzdC2cfV/ZKbbyUJ5K+HPsoqJ+bR1na31bj9uq76gfRzNw1I9zU94/x1VPrvbi6hhXPR60"
    "5sH7OUft9bhUVP/472/t8xj/nJP2pt+Dzkm9n7R/vV86nv591tfLRlEdX2v7mrGvtX3t7arrcFWvt8HPuWv9+0q5/JyH9vjQfh86"
    "5qljnppfoLkE2k+ofYbae6g1Qu3ppXNejqJr89IaL+3npTnpfcWJNNNor/iK9vBWP2/t76Pr+9E+Pjrvo/M+Wufz77jOj9VfrP3F"
    "qhtvFdX7aqZfzeareX/vPzdVUwxlrxyU089NZ5SZslAuiq9clafy+rmZrFJQSkpP+f7cbP/n5gbKUBkpY2WiTBXVys0V1cstlZWy"
    "VjbKVtkpWj9nK47iKuold1TUT85Tzop6yamXnHrJ3RT1n3so6isXKOHPzecV9ZJX7bzOz79/bqGpqJeC6hYtRf0VtY7el92i6hQ/"
    "P1fva67ez1y9H7kl1S2nldzPrei4inqoqH5F9SvRz60WFc2tql6qWruqx6t6vJZS9Fytqmg/NZ1b05o17aWmtWraR72laE51zamu"
    "PuqaU1291TWnutbWe6Bb15zqmpPut9y65lTXXuqaU11z0n2OW9ec6qpdV+26atdVu64e6//0Nae65lRXb3XNqa791bWfuuZUV691"
    "7aOufuu6jnX1XNd86tp/PVZ0HRu6rvod4Ta0XkPrNbReQ+s1tF5D6zW0XkPrNbRGQ/Ubqqd7GLep10RT5za196bOb2qfzbbSVbS3"
    "puq0NE+9j7p6H3X1PurqfdTV+6ir91G3pfNaOq9VV3QdWrpmLdVoqUaro+g12jIV1WvpNdfSNW7pWrY0y5b21db3bc2tre8NzctQ"
    "/4b6N7Suof4N9W+of0P9G+rf0LwMzcvQvAztxdC8DO3H0LwMzcvQvIx/WtqfoXkZ2qOheRmal6F5GZqX7iddU9fc1GvF1M+MqRmY"
    "2qOpPZrao6k9mtqjqT2a2qOpPer+0zW1R1N7NLVHU3s0tUdTezS1R1N7NLVHU3vU72jXVJ+m+jTVp6keTfVnqj9T/Znqo6vXUVf7"
    "7WqfPa3f09o9rdtTzZ5q9lSzp5p6T3f1nu72NIee5tDTHHqq31P9nur3VL+nOfS0Rk9z6GmdntbpaZ2e5tDTHHqaQ09z6Kt+X/vq"
    "a1+6l3Z1L+321Udf17mv13Bfr+G+rkVfr+G+XsN9vYb76rGva9LXNemr176uSV+99NVLX7301UtfvfTVS1+99NVLX3301UdffVj6"
    "WbH0s6LPDq4+O7iW1rG0jqV1LK1haQ1La1haw9IaltawtIalNSytYWkNS2tYWsPSGpbWsLSGpRkOdO2G2s9Q+xlqP0PtZ6jrNNR1"
    "Guo66X3S1fukO9RMh5rpUDMdaqZDzXSomQ71Whzq9TfUa1GfH9yheh2q16F6HarXoXodqteheh1qJkP1O1S/Q/U7VL9D9TtUv0P1"
    "O1S/Q/U7VL9D9TtSvZHqjVRvpHoj1Rup3kj1Rqo3Ur2R6o1Ub6R6I9UbqZ7uo92R6o1Ub6R6I9Ub/dPT/vUZyx1p/yPtf6TrPdKc"
    "R5rzSHMe6XqPdL1Hut4jXe+RrvdIr/uRXvcjzUqfId2xXvNjvebHmttYr7mxXvNjve7Gmt1YMxprRmPNaKwZjTWjseYyVs9j9TRW"
    "T2P1NFZPY/Wk+3V3rJ7G6mmsnsbqZ6x+JroeE12Hifaje3l3onMnOneicyc6d6JzJzp3onMn6nuq9ae6DlPNa6p56X7GnWpGU81o"
    "qhlNNaOp5qPPQO5U9aaqN1W9qfY60x5m2sNMNWb6uZ3p9T3TPmbqfaZ5z9T7TLVmqjVTrZlmPVOtmWrN1MtMvczUtz4HuDPNcaZ+"
    "Zprj7J+25jjTHGea40xznGmOM81xpjnqXtnVvZare2VX98qu7pNd3Se7uk92dZ/s6h7Z1T2yq3tkV/fH7lyvwbn6mmu+c73u5npN"
    "6J7K3al/3Re7rs476Jij+tV9jXvUWrqXcc+ax129PPS8Pq+6uvc4pP7h/A4Zfc1WfodiVxko4e9Qfv8OlZKy/h30HnXQ+9FB70OH"
    "jh7r9H+HbuZ30Gfmg2Upek4/Zwf9jB30M3bQz9hBP18H/UwdBqo7qP4Ous4HXd/DdPY7zNLK53dYaa3VVNH5q+vvsC4qOn49+R10"
    "j37QffdBn30Pjmof/qG6h5NyUQJFfR4i5fs7HFXzqHOPOuc4VNSzPrsfjjrvqLWPOlf3d4ej1jk+FJ2v2RxOqnXS+V5K0bn6THW4"
    "qMfrXdFxV61/1fM39XPLKlrjof086kpTaSk6/jFX9orW0X3e4alZ6jPWIVAvwUrZKpp1oB5CrfvSHF/G76x9nM/73/nR+J2jye+s"
    "zwXn+Pi7VMb/+2t7f+3rX/vxZ+z/+v6fNfwb5/7Gzb/x8m/e/Juv/janP3v8Z1//7Pvfq5mknSQdJdlTUnkm1UFSHSbVMKlGSX2b"
    "NC6JsUoGi2ScSibvZHFPNsVk00423WRzSbajZDtLdsvklEu8VHKOk8szuXwSP534VnIrJ8EsCbbJK5O8BslrmnyKyaeUfMzkc0/i"
    "QhL3kviRxM/km06+meRrJt958t0k3wOkUpAqQKoEqTKkqpBqQ6oHKRdSPqTLkG5D+gbpO6Q/kKlBpg2ZHmQsyAwgs4TMETIeZK6Q"
    "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"
    "S7pv6b6nu0P3M90vdPfpfqX7g+4h3V/0SNMjS48cPQr0KNGjTI8aPRr0aNKjRY82PQx69OgxpseEHlN6zOmxoMeSHit67Ojh0MOl"
    "x4EeR3p49DjT40IPnx5XetzocadHQI+QHloooseHHjE9vvTM0bNIzwo9q/Rs07NDT4OeJj379LToOaDnkJ4Tek7pOafngp4rem7p"
    "uaenTc8DPT16Xujp0/NGzwc9Q3pG//3jTomCMgUVCqoUtChoU9CloE/BiIIJBVMKZhSsKNhR4FJwpOBEgUfBhQKfgisFNwruFDwo"
    "eFIQUvChIKYwS2GewgKFHQpNCrsUDimcUrigcEmhTaFDoUvhkcIThR6FZwqvFD4oDCgMKYwofFP4oVClvvRK06tAryK9SvSq0KtG"
    "rzq9mvQy6GXSq0uvHr0seo3p/aFPlj4l+tTo06DPmT53+jwpzlNcoLhEcZXiFcUbivcU2xQ/6Nuhr0vfA31D+n44deDUidM9Tk85"
    "7XH6zGmf01dO3zn94PST0yGnP5yOOZPnnP6UODfi3IpzLudCzjc43+P8gvNbzrucv3I+4EKWC10uDLkw5cKcC0su2Fz4cCHmwpeL"
    "ZS7WudjkosXFIRdnXJxzccnFDRf3XHxxqcilEpfKXKpwqccli8sDLq+5vOWyy+ULl59cif77Xxaf6xVu6E+PG0tu7LjpcfPGzYBb"
    "RW5VuHXg1o1bd26Xud3h9prbW2573H5yp84dgzsmd7rcmXLnzUaKjQIbVTZObHhs3Nj4sJlj02TTYnPK5orNDZtbNo9semx+uZvm"
    "boG7De52uGtwt8tdi7tL7trcdbh75O6TeynulbhX4V6Ne23umdyzuDfj3pZ7Nvdu3Ltz78X9Ovcb3J9wf8N9h/vHf//X0n9wP+T+"
    "i60UWzm2CmwV2aqwVWVryNaUrRlbS7aObOmYLw8KPCjzoMuDEQ/GPJjxYMcDj0cvHkU8LvAkxZMuT2Y82fJkz5OApzmeTnm65OmJ"
    "pxFPvzzL8azEswbPVjw78Mzjmc+zK88ePIt4nuZ5nucFntd53uJ5m+cmz2c8X/F8z/MLzx88j3hR4EWFFwYvurwY8mLEiwkvp7yq"
    "8KrJqzGvJrxa8OrD6yKva7y2eO3z+srrgNcRb1K8KfKmzJsmb3q8mfBmzps1bxzeHHjj8cbnzY23Jd5WedvgbZO3Bm97vLV4u+Dt"
    "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"
    "nD7OF84A5xtnhDPGkXAUHA1HxzFwTJwJjoUzxZnhzHGWOD84WxwHx8Xxcc44F5wbToyT4jxwcpwnTonzwnnj1Dgt7ghXw9VxDVwT"
    "d4o7w53jLnF/cFe4G9w97hH3hBvgXnCvuAluinvHzXBzjiHHG8eYY8LxzjHjWHB8caw41hwbvB7eEG+EJ+Ft8By8I56Hd8KL8H7x"
    "Lng3vATvjvfAy/H+fbV4H7w//AH+EP8bX8KX8RV8Dd/AN/Et/Cn+DH+Bb+Mv8X/w1/gb/C3+Ht/FD/Gv+Hf8DP+JX+CX+C/8Cr/B"
    "/+D/cepzGnD65iRxkjkpnFROGieL05TTktMPpy2nPacj5yvnG+eY851zxjnn/ObcEPQJBgQywYTAIpgSzAjmBAuCH4IVwYZgR3Ag"
    "cAmOBL8EN4KU4E7wIvhn+CPsE34RDgm/CRVCjVAnNAhNQovQJlwR7gkdQp8wILwQ3ghjwpTwTvgkLAhLwhfhh6hH1Cf6IhoQDYm+"
    "iRQijUgnMohMogXRkmhNtCE6EB2JfKIT0Znol+jCb8LF5DLlMuey4GJzibmOuOpc11yPXE9cA64h14jrv9Od65ubwe2H25rbhtuB"
    "25FbyC3hlnMruVXEPeI+8YB4RCwRK8QqsU5sEE+ILeIp8Yx4Tbwl3hHviQ/EDrFL7BGfiX+JL8Q34pg4Iy6IX8QVSY+kTzImkUkU"
    "kinJnGRBYpMsSTYkOxKX5EjikwQkIckvyYUkJclJSpKapCX5I+2TfpEOSEekEqlMqpBqpDqpSTohnZLOSDekW9IDqUPqkfqkJ9KA"
    "NCSNSG+kMemd9EGakT5JC9KS9E1akdakDemHe4/7F/dv7mPuEneZ+5T7nLvNfcn9h/ua+477gbvD3ePucw+4h9xv3BPuD+4l9xf3"
    "iuxEFpBFZFeyB1lGlpMVZB/yEfmYXCafki/IN+Q78j35gdwjP5OH5Al5Sp6Tl+Q1+R/PPs8vngOeJs8JT4vnlOeM55bnjueBp8PT"
    "5fnL88oz5pnwTHk+eJY8PxRDijGFTKFQzChsih+KNYVD4VKcKCKKX4orRUJxp3hQ5BRvioqipmgo/ih7lH3KL8ohpUypUM4obcol"
    "5YpyTXmgPFGeKS+UN8qE8kGZUeaUL8o3ZUXZ8vriNeal8NJ4mbwsXgteP7zWvDa8drz2vJ+837wr3g3vlmpJdaKKqH6pLlRXqoQq"
    "o8qpnlQN9YBao95Th9QP6py6oC6pW+o/mi8amWZBk9MqtCqtQWvSTmnntAvaJe0P7Yp2S3ugdWhdWo/2TBvQ/tJeaWPahPZBW9CW"
    "tA0fnY/BZ8LH4jPns+Cz5a/P36xz+vvOWXqdO1h07rfZuZb+j1vnzj6dO7c7d//sXOfducdB58byP/5ls6xz63/5z707euvuWFy6"
    "4/uv86Si81ZG5+3rznOifzw6L/m3+5Sd3/c6/7vo/FnU+b9V51/+zezVnZRdd9IG3Wlx6k72d3datt3peOxOL6c7NW13/gm6s2d0"
    "599VF2yX/3h2wW7fBYdeF0T/ds+sC4qgC5X0H68uVI9d6NddeL50YdD7x7YLQ7MLb6N/GF2YfHfRPukiJ+8iz+qi4qdL6/1//9pq"
    "0w=="
)
_simplified, _traditional = zlib.decompress(base64.b64decode(_DATA)).decode("utf-8").split("\n", 1)
SIMPLIFIED_ONLY = frozenset(_simplified)
TRADITIONAL_ONLY = frozenset(_traditional)
MIN_SIMPLIFIED_EVIDENCE = 5


def is_simplified(text: str) -> bool:
    """Return whether text proves Simplified Chinese without any Traditional evidence."""
    if any(character in TRADITIONAL_ONLY for character in text):
        return False
    evidence = {character for character in text if character in SIMPLIFIED_ONLY}
    return len(evidence) >= MIN_SIMPLIFIED_EVIDENCE


def decoded_simplified(content: bytes | str) -> bool:
    if isinstance(content, bytes):
        encodings = (
            ("utf-16",)
            if content.startswith((b"\xff\xfe", b"\xfe\xff"))
            else ("utf-8-sig", "gb18030")
        )
        for encoding in encodings:
            try:
                return is_simplified(content.decode(encoding))
            except UnicodeDecodeError:
                continue
        return False
    return is_simplified(content)


def require_simplified(text: str, provider: str) -> None:
    """Fail closed unless timed subtitle dialogue proves Simplified Chinese."""
    if not is_simplified(text):
        raise APIThrottled(provider + ": subtitle lacks Simplified Chinese evidence")


_original_is_valid = Subtitle.is_valid


def strict_chinese_is_valid(subtitle: Subtitle) -> bool:
    """Reject Chinese content outside the provider overlays before Bazarr saves it."""
    content = subtitle.content
    if subtitle.language.alpha3 == "zho" and content is not None and not decoded_simplified(content):
        return False
    return _original_is_valid(subtitle)


Subtitle.is_valid = strict_chinese_is_valid
