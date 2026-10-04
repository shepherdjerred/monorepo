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
            ->addOption('season', null, InputOption::VALUE_REQUIRED);
    }
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $registration = $input->getOption('registration');
        $season = $input->getOption('season');
        if (!in_array($registration, ['enabled', 'disabled'], true) || !in_array($season, ['normal', 'halloween', 'christmas'], true)) {
            throw new \RuntimeException('Invalid operational configuration');
        }
        $settings = \XF::options()->registrationSetup;
        $settings['enabled'] = $registration === 'enabled';
        \XF::repository('XF:Option')->updateOption('registrationSetup', $settings);
        \XF::app()->registry()->set('stormForumSeason', $season);
        $styles = \XF::app()->registry()->get('stormForumStyles');
        if ($styles) {
            $styleId = $styles['light:' . $season] ?? null;
            if (!$styleId || !\XF::em()->find('XF:Style', $styleId)) { throw new \RuntimeException('Configured seasonal style is missing'); }
            if (\XF::options()->defaultStyleId != $styleId) {
                \XF::repository('XF:Option')->updateOption('defaultStyleId', $styleId);
            }
        }
        $output->writeln('Operational policy applied.');
        return 0;
    }
}
