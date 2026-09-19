document.querySelectorAll(".scroll-role").forEach(button => {

    button.addEventListener("click", function (e) {

        e.preventDefault();

        const target = document.querySelector("#roles");

        const startPosition = window.pageYOffset;
        const targetPosition = target.offsetTop;

        const distance = targetPosition - startPosition;

        const duration = 1400;

        let startTime = null;


        function scrollAnimation(currentTime) {

            if (startTime === null) {
                startTime = currentTime;
            }

            const elapsed = currentTime - startTime;

            const progress = Math.min(elapsed / duration, 1);


            // Ease-in-out animation
            const ease =
                progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;


            window.scrollTo(
                0,
                startPosition + distance * ease
            );


            if (progress < 1) {
                requestAnimationFrame(scrollAnimation);
            }
        }


        requestAnimationFrame(scrollAnimation);

    });

});