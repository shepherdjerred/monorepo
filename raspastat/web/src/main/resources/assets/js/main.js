document.addEventListener("DOMContentLoaded", function () {
    document.querySelector(".details > a").addEventListener("click", function () {
        if (document.querySelector(".details > ul").style.display == "none") {
            document.querySelector(".details > a").innerHTML = "Hide Details";
            document.querySelector(".details > ul").style.display = "block";
        } else {
            document.querySelector(".details > a").innerHTML = "Show Details";
            document.querySelector(".details > ul").style.display = "none";
        }
    })
});