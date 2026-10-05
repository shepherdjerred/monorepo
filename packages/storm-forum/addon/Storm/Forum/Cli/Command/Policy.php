<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
final class Policy extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void
    {
        $this->setName('storm:policy')
            ->addOption('registration', null, InputOption::VALUE_REQUIRED)
            ->addOption('season', null, InputOption::VALUE_REQUIRED)
            ->addOption('selection', null, InputOption::VALUE_REQUIRED, 'Default style selection: follow or fixed.', 'fixed');
    }
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $registration = $input->getOption('registration');
        $season = $input->getOption('season');
        $selection = $input->getOption('selection');
        if (!in_array($registration, ['enabled', 'disabled'], true) || !is_string($season) || !in_array($selection, ['follow','fixed'], true)) {
            throw new \RuntimeException('Invalid operational configuration');
        }
        // Complete appearance preflight before changing any operational state.
        \XF::app()->service('Storm\Forum:SeasonPolicy')->apply($season, $selection === 'follow');
        $settings = \XF::options()->registrationSetup;
        $settings['enabled'] = $registration === 'enabled';
        if (\XF::options()->registrationSetup !== $settings) { \XF::repository('XF:Option')->updateOption('registrationSetup', $settings); }
        $output->writeln('Operational policy applied.');
        return 0;
    }
}
